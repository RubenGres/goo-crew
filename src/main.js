import * as THREE from "three";
import "./style.css";
import { Engine } from "./core/engine.js";
import { sfx } from "./core/audio.js";
import { randomSeed } from "./core/rng.js";
import { newGame, tick, applyCommand, serialize, applySnapshot, orderCrewTo, startCombat } from "./game/state.js";
import { PLAYER_SHIP, ENEMY_SHIPS } from "./ship/defs.js";
import { ShipView } from "./ship/shipview.js";
import { FxPool } from "./game/fx.js";
import { Hud } from "./game/hud.js";
import { NetSession } from "./net/session.js";
import { createHostServer, createClientTransport, makeRoomCode } from "./net/peer.js";

// ============================================================================
// GOO CREW — an FTL-like with a seamless goo crew. Solo or 2-player co-op.
// Host simulates; the partner streams commands and renders snapshots.
// ============================================================================

const canvas = document.getElementById("scene");
const hudRoot = document.getElementById("hud");
const overlayRoot = document.getElementById("overlays");

const engine = new Engine(canvas);
const fxPool = new FxPool(engine.scene);

const PLAYER_POS = new THREE.Vector3(-4.6, 0, 0.2);
const ENEMY_POS = new THREE.Vector3(5.4, 0, 0.2);

// ---------------------------------------------------------------------------
// app state

const app = {
  mode: null, // 'solo' | 'host' | 'client'
  G: null,
  session: null, // NetSession (single co-op partner)
  server: null, // host's peer server handle
  ui: { selectedCrew: null, targetingWi: null },
  views: { player: null, enemy: null },
  enemyKey: null,
  projectiles: new Map(), // id -> {mesh, t, kind, side}
  lastFxSeq: 0,
  snapshotT: 0,
  warpT: 0,
  enemyIntroT: 0,
  enemyDeathT: 0,
  partnerCursor: null, // {x, z} world coords
  running: false,
};

function send(cmd) {
  if (!app.G) return;
  if (app.mode === "client") {
    app.session?.sendCmd(cmd);
  } else {
    if (cmd.k === "restart") return restartRun();
    applyCommand(app.G, cmd);
  }
}

const hud = new Hud(hudRoot, overlayRoot, {
  send,
  ui: app.ui,
  sfx,
  onRestart: () => send({ k: "restart" }),
});

// ---------------------------------------------------------------------------
// run lifecycle

function freshGame() {
  const G = newGame(randomSeed());
  // QoL: crew jog to sensible stations at run start
  const P = G.ships.player;
  const posts = ["pilot", "weapons", "shields"];
  P.crew.forEach((c, i) => orderCrewTo(P, c, posts[i % posts.length]));
  return G;
}

function restartRun() {
  app.G = freshGame();
  app.lastFxSeq = 0;
  app.ui.selectedCrew = null;
  app.ui.targetingWi = null;
  hud._modalKey = undefined;
  hud.toast("New run. Good luck out there, captain(s).", "good");
}

function buildPlayerView() {
  app.views.player = new ShipView(engine.scene, PLAYER_SHIP, "player", fxPool);
  app.views.player.group.position.copy(PLAYER_POS);
}

function syncEnemyView(G) {
  const key = G.ships.enemy?.defKey ?? null;
  if (key === app.enemyKey) return;
  if (app.views.enemy) {
    app.views.enemy.dispose();
    app.views.enemy = null;
  }
  app.enemyKey = key;
  if (key) {
    const def = ENEMY_SHIPS.find((d) => d.key === key);
    app.views.enemy = new ShipView(engine.scene, def, "enemy", fxPool);
    app.views.enemy.group.position.copy(ENEMY_POS);
    app.enemyIntroT = 1;
  }
}

// ---------------------------------------------------------------------------
// fx event stream -> juice

function consumeFx(G) {
  for (const ev of G.fx) {
    if (ev.seq <= app.lastFxSeq) continue;
    app.lastFxSeq = ev.seq;
    const view = ev.side === "enemy" ? app.views.enemy : app.views.player;
    switch (ev.k) {
      case "shot":
        sfx.play(ev.kind === "missile" ? "missile" : "laser");
        break;
      case "hitHull": {
        sfx.play("hitHull");
        if (view && ev.room) {
          const p = view.roomWorldCenter(ev.room);
          fxPool.explosion(p, 0.8);
          view.hitFlash = 1;
        }
        engine.addShake(ev.side === "player" ? 0.55 : 0.25);
        if (ev.side === "player") hud.flashScreen(0.12);
        break;
      }
      case "hitShield": {
        sfx.play("hitShield");
        if (view) {
          const p = view.group.position.clone().add(new THREE.Vector3(ev.side === "player" ? 2.6 : -2.6, 0.6, 0));
          fxPool.shieldHit(p, 1.2);
        }
        break;
      }
      case "miss":
        sfx.play("miss");
        break;
      case "fireStart":
        if (ev.side === "player") {
          sfx.play("alarm");
          hud.toast(`🔥 Fire in ${ev.room?.toUpperCase()}!`, "bad");
        } else {
          sfx.play("fire");
        }
        break;
      case "breach":
        if (ev.side === "player") {
          sfx.play("alarm");
          hud.toast(`🕳 Hull breach in ${ev.room?.toUpperCase()}!`, "bad");
        }
        break;
      case "shipExplode": {
        sfx.play("explosion");
        engine.addShake(1);
        hud.flashScreen(0.55);
        if (view) {
          const c = view.group.position.clone().add(new THREE.Vector3(0, 0.6, 0));
          for (let i = 0; i < 7; i++) {
            const off = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 0.8, (Math.random() - 0.5) * 2.5);
            setTimeout(() => fxPool.explosion(c.clone().add(off), 1.2 + Math.random()), i * 130);
          }
          if (ev.side === "enemy") app.enemyDeathT = 1.1;
        }
        break;
      }
      case "crewDie":
        sfx.play("crewDie");
        if (ev.side === "player") hud.toast(`💀 ${ev.name} didn't make it.`, "bad");
        break;
      case "ftlReady":
        sfx.play("ftlReady");
        hud.toast("FTL drive charged — jump when ready!", "good");
        break;
      case "jump":
        sfx.play("jump");
        app.warpT = 1.6;
        hud.flashScreen(0.7);
        engine.restyleBackdrop(Math.random);
        break;
      case "enemyArrive":
        sfx.play("alarm");
        hud.toast(`⚔ ${ev.name} on scope!`, "bad");
        break;
      case "scrap":
        if ((ev.n ?? 0) > 0) sfx.play("scrap");
        break;
      case "toast":
        hud.toast(ev.msg);
        break;
      case "heal":
        sfx.play("heal");
        break;
      case "repaired":
        if (ev.side === "player") sfx.play("heal");
        break;
      case "pause":
        sfx.play("ui");
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// projectiles (visual layer over state.projectiles)

const laserTexMat = new THREE.SpriteMaterial({ color: 0xffd76a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
function makeProjMesh(kind) {
  const g = new THREE.Group();
  if (kind === "missile") {
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 8), new THREE.MeshBasicMaterial({ color: 0xffe0b8 }));
    body.rotation.z = -Math.PI / 2;
    g.add(body);
  } else {
    const s = new THREE.Sprite(laserTexMat.clone());
    s.scale.set(0.85, 0.16, 1);
    g.add(s);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff6d8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.set(0.4, 0.09, 1);
    g.add(core);
  }
  engine.scene.add(g);
  return g;
}

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
function updateProjectiles(G, dt) {
  const seen = new Set();
  for (const p of G.projectiles) {
    seen.add(p.id);
    let vis = app.projectiles.get(p.id);
    if (!vis) {
      vis = { mesh: makeProjMesh(p.kind), t: p.t, kind: p.kind, side: p.side, trailT: 0 };
      app.projectiles.set(p.id, vis);
    }
    // advance locally for smoothness; never fall behind the sim
    vis.t = Math.max(vis.t + dt / p.dur, Math.min(p.t, 1));
    const t = Math.max(0, Math.min(1, vis.t));
    const srcView = p.side === "player" ? app.views.player : app.views.enemy;
    const dstView = p.targetSide === "player" ? app.views.player : app.views.enemy;
    if (!srcView || !dstView) {
      vis.mesh.visible = false;
      continue;
    }
    srcView.mountPoint(p.wi ?? 0, _from);
    dstView.roomWorldCenter(p.room, _to);
    vis.mesh.visible = vis.t >= 0;
    vis.mesh.position.lerpVectors(_from, _to, t);
    if (p.kind === "missile") {
      vis.mesh.position.y += Math.sin(t * Math.PI) * 1.6; // lob
      vis.mesh.lookAt(_to.x, _to.y + Math.cos(t * Math.PI) * 1.6, _to.z);
      vis.mesh.rotateY(Math.PI / 2);
      vis.trailT -= dt;
      if (vis.trailT <= 0 && vis.mesh.visible) {
        vis.trailT = 0.03;
        fxPool.spawn({ pos: vis.mesh.position, life: 0.5, scale: 0.16, scaleEnd: 0.04, color: 0xbfc8dd, opacity: 0.7, soft: true });
      }
    } else {
      const dir = _to.clone().sub(_from);
      vis.mesh.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    }
  }
  for (const [id, vis] of app.projectiles) {
    if (!seen.has(id)) {
      engine.scene.remove(vis.mesh);
      app.projectiles.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// picking

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pickAt(clientX, clientY) {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, engine.camera);
  const pickables = [
    ...(app.views.player?.pickables ?? []),
    ...(app.views.enemy?.pickables ?? []),
  ];
  const hits = raycaster.intersectObjects(pickables, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData?.type) o = o.parent;
    if (o?.userData?.type) return { data: o.userData, point: h.point };
  }
  return null;
}

function onTap(x, y) {
  if (!app.G || app.G.over) return;
  sfx.ensure();
  const hit = pickAt(x, y);
  if (!hit) return;
  const d = hit.data;

  // weapon targeting mode: clicking an enemy room aims the armed weapon
  if (app.ui.targetingWi != null) {
    if (d.ship === "enemy" && d.type === "room") {
      send({ k: "wtarget", wi: app.ui.targetingWi, room: d.room });
      app.ui.targetingWi = null;
      sfx.play("ui");
      return;
    }
    app.ui.targetingWi = null;
  }

  if (d.type === "crew" && d.ship === "player") {
    app.ui.selectedCrew = app.ui.selectedCrew === d.id ? null : d.id;
    sfx.play("select");
    return;
  }
  if (d.type === "door" && d.ship === "player") {
    send({ k: "door", id: d.id });
    sfx.play("door");
    return;
  }
  if (d.type === "room" && d.ship === "player" && app.ui.selectedCrew) {
    send({ k: "move", crew: app.ui.selectedCrew, room: d.room });
    sfx.play("order");
    return;
  }
  if (d.type === "room" && d.ship === "enemy") {
    // shortcut: clicking enemy room with a ready, untargeted weapon aims it
    const P = app.G.ships.player;
    const wi = P.weapons.findIndex((w) => !w.target);
    if (wi >= 0) {
      send({ k: "wtarget", wi, room: d.room });
      sfx.play("ui");
    }
  }
}

canvas.addEventListener("pointerdown", (e) => {
  if (!app.running) return;
  onTap(e.clientX, e.clientY);
});

// partner cursor: share where the other player is pointing (world coords)
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.4);
const _cursorWorld = new THREE.Vector3();
let cursorSendT = 0;
window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, engine.camera);
  raycaster.ray.intersectPlane(groundPlane, _cursorWorld);
});

window.addEventListener("keydown", (e) => {
  if (!app.running || !app.G) return;
  if (e.code === "Space") {
    e.preventDefault();
    send({ k: "pause" });
  } else if (e.code === "Escape") {
    app.ui.selectedCrew = null;
    app.ui.targetingWi = null;
  } else if (/^Digit[1-8]$/.test(e.code)) {
    const i = Number(e.code.slice(5)) - 1;
    const crew = app.G.ships.player?.crew.filter((c) => !c.dead)[i];
    if (crew) {
      app.ui.selectedCrew = crew.id;
      sfx.play("select");
    }
  }
});

// ---------------------------------------------------------------------------
// menu

function showMenu(status = "") {
  app.running = false;
  overlayRoot.querySelector(".modalwrap")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "modalwrap";
  wrap.innerHTML = `
    <div class="modal" style="text-align:center">
      <h1 class="title-logo"><span class="a">GOO</span> <span class="b">CREW</span></h1>
      <div class="tagline">Keep the soup flying. An FTL-ish co-op roguelike crewed by seamless goo.</div>
      <div class="menubtns">
        <button class="btn accent" id="btn-solo">▶ SOLO RUN</button>
        <button class="btn" id="btn-host">🛰 HOST CO-OP</button>
        <div class="roomrow">
          <input id="room-input" maxlength="4" placeholder="CODE" autocomplete="off" />
          <button class="btn" id="btn-join">JOIN</button>
        </div>
        <div class="netstatus" id="netstatus">${status}</div>
        <div class="hint">Order the crew, split the reactor, aim the guns, vent the fires.<br/>Co-op: both captains command the same ship. Chaos is a feature.</div>
      </div>
    </div>`;
  overlayRoot.appendChild(wrap);
  const netstatus = wrap.querySelector("#netstatus");

  wrap.querySelector("#btn-solo").onclick = () => {
    sfx.ensure();
    sfx.play("ui");
    startSolo();
    wrap.remove();
  };
  wrap.querySelector("#btn-host").onclick = () => {
    sfx.ensure();
    sfx.play("ui");
    const code = makeRoomCode();
    netstatus.textContent = `Opening room ${code}…`;
    app.server = createHostServer(code, {
      onReady: (err) => {
        if (err) {
          netstatus.textContent = `Broker error: ${err.type || err}. Try again.`;
          return;
        }
        startHost(code);
        wrap.remove();
      },
      onPeerConnect: (tr) => attachPartner(tr),
    });
  };
  wrap.querySelector("#btn-join").onclick = () => {
    sfx.ensure();
    const code = wrap.querySelector("#room-input").value.trim().toUpperCase();
    if (code.length < 4) {
      netstatus.textContent = "Enter the 4-letter room code.";
      return;
    }
    netstatus.textContent = `Dialing ${code}…`;
    const tr = createClientTransport(code, (err) => {
      if (err) netstatus.textContent = `Connection failed: ${err.type || err}`;
    });
    app.session = new NetSession("client", tr, {
      onConnect: () => {
        startClient();
        wrap.remove();
      },
      onDisconnect: () => {
        hud.toast("Partner link lost.", "bad");
        showMenu("Disconnected from host.");
      },
      onSnapshot: (d, msg) => {
        if (!app.G) app.G = {};
        applySnapshot(app.G, d);
        if (msg.cursor) app.partnerCursor = msg.cursor;
      },
    }).start();
  };
}

function attachPartner(tr) {
  // one co-op partner: replace any previous session
  if (app.session) {
    try {
      app.session.close();
    } catch {}
  }
  app.session = new NetSession("host", tr, {
    onConnect: () => hud.toast("🤝 Co-captain aboard!", "good"),
    onDisconnect: () => hud.toast("Co-captain link lost.", "bad"),
    onCmd: (cmd) => {
      if (!app.G) return;
      if (cmd.k === "restart") return restartRun();
      applyCommand(app.G, cmd);
    },
    onCursor: (msg) => {
      app.partnerCursor = { x: msg.x, z: msg.y };
    },
  }).start();
}

function startSolo() {
  app.mode = "solo";
  app.G = freshGame();
  app.running = true;
}

function startHost(code) {
  app.mode = "host";
  app.G = freshGame();
  app.running = true;
  hud.toast(`Room open — code: ${code}. Runs start now; partner can drop in.`, "good");
  app.roomCode = code;
}

function startClient() {
  app.mode = "client";
  app.G = null; // filled by first snapshot
  app.running = true;
  hud.toast("Linked! The host runs the sim; you command the same ship.", "good");
}

// ---------------------------------------------------------------------------
// main loop

buildPlayerView();

let last = performance.now();
let acc = 0;
const STEP = 1 / 60;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // simulate (host/solo only)
  if (app.running && app.G && app.mode !== "client") {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      tick(app.G, STEP);
      acc -= STEP;
      steps++;
    }
    // snapshots at 8Hz
    if (app.session?.connected) {
      app.snapshotT -= dt;
      if (app.snapshotT <= 0) {
        app.snapshotT = 1 / 8;
        app.session.sendSnapshot(serialize(app.G), _cursorWorld ? { x: _cursorWorld.x, z: _cursorWorld.z } : null);
      }
    }
  }

  // client: stream cursor + commands are event-driven
  if (app.running && app.mode === "client" && app.session?.connected) {
    cursorSendT -= dt;
    if (cursorSendT <= 0) {
      cursorSendT = 1 / 12;
      app.session.sendCursor(_cursorWorld.x, _cursorWorld.z);
    }
  }

  const G = app.G;
  if (app.running && G && G.ships) {
    const paused = !!(G.paused || G.event || G.shopStock || G.mapOpen || G.over);
    syncEnemyView(G);
    consumeFx(G);
    app.views.player.update(dt, G.ships.player, now / 1000, paused);
    if (app.views.enemy && G.ships.enemy) app.views.enemy.update(dt, G.ships.enemy, now / 1000, paused);
    updateProjectiles(G, paused ? 0 : dt);

    // enemy intro slide-in
    if (app.views.enemy) {
      if (app.enemyIntroT > 0) {
        app.enemyIntroT = Math.max(0, app.enemyIntroT - dt);
        const k = 1 - app.enemyIntroT;
        const ease = 1 - Math.pow(1 - k, 3);
        app.views.enemy.group.position.x = ENEMY_POS.x + (1 - ease) * 9;
        app.views.enemy.group.scale.setScalar(0.6 + 0.4 * ease);
      } else {
        app.views.enemy.group.position.x = ENEMY_POS.x;
        app.views.enemy.group.scale.setScalar(1);
      }
    }
    // enemy death fade
    if (app.enemyDeathT > 0 && app.views.enemy) {
      app.enemyDeathT -= dt;
      app.views.enemy.group.position.y = -app.enemyDeathT * 0; // hold
      app.views.enemy.group.visible = Math.floor(app.enemyDeathT * 14) % 2 === 0; // flicker out
      if (app.enemyDeathT <= 0) app.views.enemy.setVisible(false);
    }

    // hud
    const net =
      app.mode === "host"
        ? `room <b>${app.roomCode}</b> · ${app.session?.connected ? `co-op ✓ ${Math.round(app.session.rtt)}ms` : "waiting for partner…"}`
        : app.mode === "client"
          ? `co-op ✓ ${Math.round(app.session?.rtt ?? 0)}ms`
          : "";
    hud.update(G, net);

    // partner cursor projection
    if (app.partnerCursor && (app.mode === "client" || app.session?.connected)) {
      _v.set(app.partnerCursor.x, 0.4, app.partnerCursor.z).project(engine.camera);
      hud.partnerCursor.style.opacity = 0.85;
      hud.partnerCursor.style.left = `${((_v.x + 1) / 2) * window.innerWidth}px`;
      hud.partnerCursor.style.top = `${((1 - _v.y) / 2) * window.innerHeight}px`;
    } else {
      hud.partnerCursor.style.opacity = 0;
    }
  }

  // warp streaks
  if (app.warpT > 0) app.warpT = Math.max(0, app.warpT - dt);
  const starSpeed = 1 + app.warpT * 26;

  fxPool.update(dt);
  engine.update(dt, starSpeed);
  engine.render();
}

const _v = new THREE.Vector3();

showMenu();
requestAnimationFrame(frame);

// tiny debug/console surface (also used by the headless screenshot check)
window.__slop = {
  app,
  engine,
  send,
  debugCombat(key = "fighter") {
    if (app.G && app.mode !== "client") startCombat(app.G, key);
  },
};
