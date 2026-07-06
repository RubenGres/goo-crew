// ============================================================================
// The whole game simulation, host-authoritative and node-safe (no three.js).
// One tick() advances everything: power, shields, weapons, projectiles, O2,
// fire, breaches, crew movement/work, FTL charge, enemy AI hooks, win/lose.
// The client never simulates — it renders snapshots of this state.
// ============================================================================

import { makeRng } from "../core/rng.js";
import { PLAYER_SHIP, ENEMY_SHIPS, WEAPON_TYPES, SYS_INFO } from "../ship/defs.js";
import { makeLayout, pickTile } from "../ship/pathfind.js";
import { SPECIES, crewName, CREW_COLORS } from "./species.js";
import { makeSector, EVENTS, rollEvent, makeShopStock } from "./events.js";
import { aiThink } from "./ai.js";

let _crewId = 1;

export function makeCrew(spec, rand, colorIdx) {
  const stats = SPECIES[spec.species];
  return {
    id: `c${_crewId++}`,
    name: spec.name || crewName(rand),
    species: spec.species,
    color: CREW_COLORS[colorIdx % CREW_COLORS.length],
    hp: stats.hp,
    hpMax: stats.hp,
    x: 0,
    y: 0,
    path: [],
    destRoom: null,
    action: "idle", // idle|walk|man|repair|douse|breach|heal|dead
    dead: false,
  };
}

export function makeShip(def, side, rand) {
  const systems = {};
  for (const r of def.rooms) {
    if (r.sys) systems[r.sys] = { lvl: r.lvl, dmg: 0, power: 0 };
  }
  const layout = makeLayout(def);
  const ship = {
    side,
    defKey: def.key,
    name: def.name,
    hull: def.hull,
    hullMax: def.hull,
    reactor: def.reactor,
    systems,
    rooms: def.rooms.map((r) => ({ id: r.id, o2: 1, fire: 0, breach: 0 })),
    doors: layout.doors.map((d) => ({ id: d.id, open: false, crewT: 0 })),
    weapons: def.weapons.map((w) => ({ type: w, charge: 0, target: null })),
    crew: [],
    shieldLayers: 0,
    shieldCharge: 0,
  };
  def.crew.forEach((c, i) => {
    const crew = makeCrew(c, rand, side === "player" ? i : i + 4);
    const room = def.rooms[i % def.rooms.length];
    crew.x = room.x + (i % room.w);
    crew.y = room.y;
    ship.crew.push(crew);
  });
  autoPower(ship);
  return ship;
}

export function shipDef(ship) {
  if (ship.defKey === PLAYER_SHIP.key) return PLAYER_SHIP;
  return ENEMY_SHIPS.find((d) => d.key === ship.defKey);
}

const _layoutCache = new Map();
export function shipLayout(ship) {
  const def = shipDef(ship);
  if (!_layoutCache.has(def.key)) _layoutCache.set(def.key, makeLayout(def));
  return _layoutCache.get(def.key);
}

// sensible default power split
export function autoPower(ship) {
  let left = ship.reactor;
  const order = ["shields", "engines", "weapons", "oxygen", "medbay", "pilot"];
  for (const s of order) {
    const sys = ship.systems[s];
    if (!sys) continue;
    sys.power = 0;
  }
  for (const s of order) {
    const sys = ship.systems[s];
    if (!sys) continue;
    const want = s === "medbay" ? 0 : Math.min(sys.lvl, left);
    sys.power = want;
    left -= want;
    if (left <= 0) break;
  }
}

export function newGame(seed) {
  const rand = makeRng(seed);
  const G = {
    seed,
    time: 0,
    beaconT: 0,
    paused: false,
    phase: "idle", // idle|combat|victory|defeat
    mapOpen: false,
    scrap: 20,
    sector: makeSector(rand),
    ships: { player: makeShip(PLAYER_SHIP, "player", rand), enemy: null },
    projectiles: [],
    projId: 1,
    ftl: 0,
    event: null,
    shopStock: null,
    over: null,
    fx: [],
    fxSeq: 1,
    _rand: rand,
    aiT: 0,
  };
  return G;
}

export function fx(G, k, data = {}) {
  G.fx.push({ seq: G.fxSeq++, k, ...data });
  if (G.fx.length > 48) G.fx.splice(0, G.fx.length - 48);
}

// ---------------------------------------------------------------------------
// derived stats

export function effPower(ship, sysName) {
  const sys = ship.systems[sysName];
  if (!sys) return 0;
  return Math.max(0, Math.min(sys.power, Math.floor(sys.lvl - sys.dmg)));
}

export function isManned(ship, sysName) {
  const def = shipDef(ship);
  const room = def.rooms.find((r) => r.sys === sysName);
  if (!room) return false;
  return ship.crew.some(
    (c) => !c.dead && c.path.length === 0 && shipLayout(ship).roomAt(c.x, c.y) === room.id,
  );
}

export function evasion(ship) {
  let ev = effPower(ship, "engines") * 5;
  if (isManned(ship, "pilot")) ev += 6;
  else ev = 0; // nobody flying: sitting duck (FTL rule — pilots matter!)
  if (isManned(ship, "engines")) ev += 3;
  return Math.min(45, ev);
}

export function maxShields(ship) {
  return Math.floor(effPower(ship, "shields") / 2);
}

export function powerUsed(ship) {
  let used = 0;
  for (const s of Object.values(ship.systems)) used += s.power;
  return used;
}

function weaponPowerBudget(ship) {
  return effPower(ship, "weapons");
}

// which weapon slots are live given the weapons system power
export function weaponPowered(ship) {
  let budget = weaponPowerBudget(ship);
  return ship.weapons.map((w) => {
    const cost = WEAPON_TYPES[w.type].power;
    if (budget >= cost) {
      budget -= cost;
      return true;
    }
    return false;
  });
}

function roomState(ship, roomId) {
  return ship.rooms.find((r) => r.id === roomId);
}

function sysOfRoom(ship, roomId) {
  const def = shipDef(ship);
  const room = def.rooms.find((r) => r.id === roomId);
  return room?.sys ?? null;
}

export function crewInRoom(ship, roomId) {
  const layout = shipLayout(ship);
  return ship.crew.filter((c) => !c.dead && layout.roomAt(c.x, c.y) === roomId);
}

// ---------------------------------------------------------------------------
// commands (from host player or co-op partner; host applies all)

export function applyCommand(G, cmd) {
  const P = G.ships.player;
  switch (cmd.k) {
    case "move": {
      const crew = P.crew.find((c) => c.id === cmd.crew);
      if (!crew || crew.dead) return;
      orderCrewTo(P, crew, cmd.room);
      fx(G, "order", { room: cmd.room });
      break;
    }
    case "power": {
      const sys = P.systems[cmd.sys];
      if (!sys) return;
      const used = powerUsed(P);
      if (cmd.delta > 0 && used < P.reactor && sys.power < sys.lvl) sys.power++;
      if (cmd.delta < 0 && sys.power > 0) sys.power--;
      fx(G, "power");
      break;
    }
    case "wtarget": {
      const w = P.weapons[cmd.wi];
      if (!w) return;
      if (cmd.room && G.ships.enemy) {
        const def = shipDef(G.ships.enemy);
        if (def.rooms.some((r) => r.id === cmd.room)) {
          w.target = cmd.room;
          fx(G, "target");
        }
      } else {
        w.target = null;
      }
      break;
    }
    case "door": {
      const door = P.doors.find((d) => d.id === cmd.id);
      if (door) {
        door.open = !door.open;
        fx(G, "door");
      }
      break;
    }
    case "jump": {
      if (G.ftl >= 1 && !G.over) G.mapOpen = true;
      break;
    }
    case "mapClose":
      G.mapOpen = false;
      break;
    case "choose": {
      if (!G.mapOpen || G.ftl < 1) return;
      const node = G.sector.nodes.find((n) => n.id === cmd.node);
      const here = G.sector.nodes.find((n) => n.id === G.sector.at);
      if (!node || !here) return;
      const linked = G.sector.edges.some(
        ([a, b]) => (a === here.id && b === node.id) || (b === here.id && a === node.id),
      );
      if (!linked || node.col <= here.col) return;
      doJump(G, node);
      break;
    }
    case "evchoice":
      resolveEventChoice(G, cmd.i);
      break;
    case "evclose":
      if (G.event && G.event.resolved) {
        const ev = G.event;
        G.event = null;
        if (ev.thenFight) startCombat(G, ev.thenFight);
      }
      break;
    case "buy":
      buyItem(G, cmd.i);
      break;
    case "shopClose":
      G.shopStock = null;
      break;
    case "pause":
      G.paused = !G.paused;
      fx(G, "pause");
      break;
  }
}

export function orderCrewTo(ship, crew, roomId) {
  const layout = shipLayout(ship);
  const claimed = new Set(
    ship.crew.filter((c) => c !== crew && !c.dead && c.destRoom === roomId).map((c) => `${c.destTile?.x},${c.destTile?.y}`),
  );
  const tile = pickTile(layout, roomId, claimed, true);
  if (!tile) return;
  const p = layout.path(crew.x, crew.y, tile.x, tile.y);
  if (!p) return;
  crew.path = p;
  crew.destRoom = roomId;
  crew.destTile = tile;
}

// ---------------------------------------------------------------------------
// combat + beacons

export function startCombat(G, enemyKey) {
  const def = ENEMY_SHIPS.find((d) => d.key === enemyKey) || ENEMY_SHIPS[0];
  G.ships.enemy = makeShip(def, "enemy", G._rand);
  G.phase = "combat";
  G.beaconT = 0;
  fx(G, "enemyArrive", { name: def.name });
}

function doJump(G, node) {
  G.mapOpen = false;
  G.ftl = 0;
  G.sector.at = node.id;
  node.visited = true;
  G.ships.enemy = null;
  G.projectiles = [];
  G.event = null;
  G.shopStock = null;
  G.phase = "idle";
  G.beaconT = 0;
  // out-of-combat: patch the crew up a little and refill air
  fx(G, "jump", { node: node.id });

  const rand = G._rand;
  switch (node.type) {
    case "fight":
      startCombat(G, node.enemy);
      break;
    case "elite":
      startCombat(G, node.enemy);
      break;
    case "boss":
      startCombat(G, "boss");
      break;
    case "event": {
      G.event = rollEvent(rand, node);
      break;
    }
    case "shop":
      G.shopStock = makeShopStock(G, rand);
      break;
    case "empty": {
      const found = rand.int(4, 12);
      G.scrap += found;
      fx(G, "scrap", { n: found });
      fx(G, "toast", { msg: `Quiet beacon. Salvaged ${found} scrap from debris.` });
      break;
    }
  }
}

function resolveEventChoice(G, i) {
  if (!G.event || G.event.resolved) return;
  const tpl = EVENTS.find((e) => e.id === G.event.id);
  const choice = tpl?.choices[i];
  if (!choice) return;
  const out = typeof choice.out === "function" ? choice.out(G, G._rand) : choice.out;
  G.event.resolved = true;
  G.event.result = out.text || "…";
  if (out.scrap) {
    G.scrap = Math.max(0, G.scrap + out.scrap);
    if (out.scrap > 0) fx(G, "scrap", { n: out.scrap });
  }
  if (out.hull) {
    G.ships.player.hull = Math.max(1, Math.min(G.ships.player.hullMax, G.ships.player.hull + out.hull));
    if (out.hull < 0) fx(G, "hitHull", { side: "player", room: "hall" });
  }
  if (out.crewHp) {
    for (const c of G.ships.player.crew) {
      if (!c.dead) c.hp = Math.max(1, Math.min(c.hpMax, c.hp + out.crewHp));
    }
  }
  if (out.crewAdd) {
    const crew = makeCrew({ species: out.crewAdd }, G._rand, G.ships.player.crew.length);
    const def = shipDef(G.ships.player);
    const room = def.rooms.find((r) => r.id === "hall") || def.rooms[0];
    crew.x = room.x;
    crew.y = room.y;
    G.ships.player.crew.push(crew);
    fx(G, "heal");
  }
  if (out.fight) G.event.thenFight = out.fight;
}

function buyItem(G, i) {
  const stock = G.shopStock;
  if (!stock) return;
  const item = stock[i];
  if (!item || item.sold) return;
  if (G.scrap < item.cost) return;
  const P = G.ships.player;
  switch (item.kind) {
    case "repair":
      if (P.hull >= P.hullMax) return;
      P.hull = Math.min(P.hullMax, P.hull + item.n);
      break;
    case "reactor":
      P.reactor += 1;
      item.sold = true;
      break;
    case "sys": {
      const sys = P.systems[item.sys];
      if (!sys || sys.lvl >= SYS_INFO[item.sys].maxLvl) return;
      sys.lvl += 1;
      item.sold = true;
      break;
    }
    case "weapon":
      if (P.weapons.length >= 4) return;
      P.weapons.push({ type: item.type, charge: 0, target: null });
      item.sold = true;
      break;
    case "crew": {
      const crew = makeCrew({ species: item.species }, G._rand, P.crew.length);
      const def = shipDef(P);
      const room = def.rooms.find((r) => r.id === "hall") || def.rooms[0];
      crew.x = room.x;
      crew.y = room.y;
      P.crew.push(crew);
      item.sold = true;
      break;
    }
  }
  G.scrap -= item.cost;
  fx(G, "scrap", { n: -item.cost });
}

// ---------------------------------------------------------------------------
// tick

export function tick(G, dt) {
  if (G.over) return;
  const blocked = G.paused || G.event || G.shopStock || G.mapOpen;
  if (blocked) return;

  G.time += dt;
  G.beaconT += dt;

  const P = G.ships.player;
  const E = G.ships.enemy;

  tickShip(G, P, E, dt);
  if (E) {
    G.aiT -= dt;
    if (G.aiT <= 0) {
      G.aiT = 1.25;
      aiThink(G, E, P);
    }
    tickShip(G, E, P, dt);
  }

  tickProjectiles(G, dt);

  // FTL drive charges whenever someone flies the ship
  if (G.ftl < 1 && effPower(P, "engines") > 0 && isManned(P, "pilot")) {
    const rate = 1 / 30 + effPower(P, "engines") * 0.004;
    G.ftl = Math.min(1, G.ftl + dt * rate);
    if (G.ftl >= 1) fx(G, "ftlReady");
  }

  // lose conditions
  if (P.hull <= 0) {
    fx(G, "shipExplode", { side: "player" });
    G.over = { win: false, reason: "The SS LADLE came apart at the seams." };
    G.phase = "defeat";
  } else if (P.crew.every((c) => c.dead)) {
    G.over = { win: false, reason: "With no crew left, the LADLE drifts forever." };
    G.phase = "defeat";
  }

  // enemy destroyed
  if (E && E.hull <= 0) {
    fx(G, "shipExplode", { side: "enemy" });
    const def = shipDef(E);
    const node = G.sector.nodes.find((n) => n.id === G.sector.at);
    const reward = def.scrap ? G._rand.int(def.scrap[0], def.scrap[1]) : 20;
    G.scrap += reward;
    fx(G, "toast", { msg: `${def.name} destroyed! Salvaged ${reward} scrap.` });
    fx(G, "scrap", { n: reward });
    G.ships.enemy = null;
    G.projectiles = G.projectiles.filter((p) => p.side === "enemy" ? false : p.targetSide !== "enemy");
    if (node?.type === "boss") {
      G.over = { win: true, reason: "MOTHER SPOON is soup. The sector is free!" };
      G.phase = "victory";
    } else {
      G.phase = "idle";
    }
  }
}

function tickShip(G, ship, foe, dt) {
  const layout = shipLayout(ship);
  const def = shipDef(ship);

  // ---- shields
  const maxSh = maxShields(ship);
  if (ship.shieldLayers > maxSh) ship.shieldLayers = maxSh;
  if (ship.shieldLayers < maxSh) {
    let rate = 1 / 3;
    if (isManned(ship, "shields")) rate *= 1.25;
    ship.shieldCharge += dt * rate;
    if (ship.shieldCharge >= 1) {
      ship.shieldCharge = 0;
      ship.shieldLayers++;
      if (ship.side === "player") fx(G, "shieldUp", { side: ship.side });
    }
  } else {
    ship.shieldCharge = 0;
  }

  // ---- weapons
  const powered = weaponPowered(ship);
  const wBoost = isManned(ship, "weapons") ? 1.15 : 1;
  ship.weapons.forEach((w, wi) => {
    const wt = WEAPON_TYPES[w.type];
    if (!powered[wi]) {
      w.charge = Math.max(0, w.charge - dt * 0.3);
      return;
    }
    w.charge = Math.min(1, w.charge + (dt * wBoost) / wt.charge);
    const graced = G.beaconT > 2.5; // hold fire moment after arrival
    if (w.charge >= 1 && w.target && foe && graced) {
      w.charge = 0;
      for (let s = 0; s < wt.shots; s++) {
        G.projectiles.push({
          id: G.projId++,
          side: ship.side,
          targetSide: foe.side,
          kind: wt.kind,
          dmg: wt.dmg,
          room: w.target,
          wi,
          t: -s * 0.18, // stagger volleys
          dur: wt.kind === "missile" ? 1.5 : 1.0,
        });
      }
      fx(G, "shot", { side: ship.side, kind: wt.kind, wi, room: w.target });
    }
    if (w.target && foe && !shipDef(foe).rooms.some((r) => r.id === w.target)) w.target = null;
  });

  // ---- oxygen, fire, breach per room
  const o2Power = effPower(ship, "oxygen");
  for (const room of ship.rooms) {
    const defRoom = def.rooms.find((r) => r.id === room.id);
    // life support refills every room while powered
    room.o2 += o2Power * 0.05 * dt;
    // fire eats air and hurts things
    if (room.fire > 0) {
      room.o2 -= room.fire * 0.035 * dt;
      const sysName = defRoom.sys;
      if (sysName) {
        const sys = ship.systems[sysName];
        sys.dmg = Math.min(sys.lvl, sys.dmg + room.fire * 0.05 * dt);
      }
      // fire suffocates without air, spreads with it
      if (room.o2 < 0.12) room.fire = Math.max(0, room.fire - dt * 0.5);
      else if (G._rand.chance(dt * 0.02 * room.fire)) {
        const doors = layout.roomDoors(room.id).filter((d) => d.b !== "space");
        if (doors.length) {
          const d = G._rand.pick(doors);
          const otherId = d.a === room.id ? d.b : d.a;
          const other = roomState(ship, otherId);
          if (other && other.fire === 0 && other.o2 > 0.3) {
            other.fire = 0.6;
            fx(G, "fireStart", { side: ship.side, room: otherId });
          }
        }
      }
    }
    // breach venting
    if (room.breach > 0) room.o2 -= 0.1 * dt;
    room.o2 = Math.max(0, Math.min(1, room.o2));
  }

  // door mixing (open doors and doors crew just passed through)
  for (const doorState of ship.doors) {
    const d = layout.doors[doorState.id];
    doorState.crewT = Math.max(0, doorState.crewT - dt);
    const openish = doorState.open || doorState.crewT > 0;
    if (!openish) continue;
    const ra = roomState(ship, d.a);
    if (d.b === "space") {
      ra.o2 = Math.max(0, ra.o2 - 0.3 * dt);
      // vacuum starves fires fast — the venting play
      ra.fire = Math.max(0, ra.fire - 0.35 * dt);
    } else {
      const rb = roomState(ship, d.b);
      const flow = (rb.o2 - ra.o2) * 0.9 * dt;
      ra.o2 += flow;
      rb.o2 -= flow;
      if (ra.fire > 0.2 && rb.o2 > 0.3 && G._rand.chance(dt * 0.05)) rb.fire = Math.max(rb.fire, 0.5);
    }
  }

  // ---- crew
  const medRoomId = def.rooms.find((r) => r.sys === "medbay")?.id;
  const medPower = effPower(ship, "medbay");
  for (const crew of ship.crew) {
    if (crew.dead) continue;
    const stats = SPECIES[crew.species];

    // movement along path
    if (crew.path.length) {
      crew.action = "walk";
      const next = crew.path[0];
      const dx = next.x - crew.x;
      const dy = next.y - crew.y;
      const dist = Math.hypot(dx, dy);
      const step = stats.speed * dt;
      if (dist <= step) {
        // crossing a door edge? crack it open for a beat
        const fromRoom = layout.roomAt(crew.x, crew.y);
        const toRoom = layout.roomAt(next.x, next.y);
        if (fromRoom && toRoom && fromRoom !== toRoom) {
          for (const d of layout.roomDoors(fromRoom)) {
            if ((d.a === fromRoom && d.b === toRoom) || (d.a === toRoom && d.b === fromRoom)) {
              const ds = ship.doors.find((s) => s.id === d.id);
              if (ds) ds.crewT = Math.max(ds.crewT, 0.7);
            }
          }
        }
        crew.x = next.x;
        crew.y = next.y;
        crew.path.shift();
      } else {
        crew.x += (dx / dist) * step;
        crew.y += (dy / dist) * step;
      }
    } else {
      // at destination: pick work by priority
      const roomId = layout.roomAt(crew.x, crew.y);
      const room = roomState(ship, roomId);
      const sysName = sysOfRoom(ship, roomId);
      crew.action = "idle";
      if (room) {
        if (room.fire > 0) {
          crew.action = "douse";
          room.fire = Math.max(0, room.fire - dt * 0.35 * stats.douse);
          if (room.fire === 0) fx(G, "fireOut", { side: ship.side, room: roomId });
        } else if (room.breach > 0) {
          crew.action = "breach";
          room.breach = Math.max(0, room.breach - dt * 0.16 * stats.repair);
        } else if (sysName && ship.systems[sysName].dmg > 0.01) {
          crew.action = "repair";
          const sys = ship.systems[sysName];
          sys.dmg = Math.max(0, sys.dmg - dt * 0.14 * stats.repair);
          if (sys.dmg === 0) fx(G, "repaired", { side: ship.side, sys: sysName });
        } else if (sysName && roomId !== medRoomId) {
          crew.action = "man";
        } else if (roomId === medRoomId) {
          crew.action = crew.hp < crew.hpMax ? "heal" : "idle";
        }
      }

      // medbay healing
      if (roomId === medRoomId && medPower > 0 && crew.hp < crew.hpMax) {
        crew.hp = Math.min(crew.hpMax, crew.hp + dt * 7 * medPower);
      }
    }

    // environmental damage
    const roomId = layout.roomAt(crew.x, crew.y);
    const room = roomState(ship, roomId);
    if (room) {
      if (room.fire > 0 && crew.action !== "walk") crew.hp -= room.fire * 2.6 * dt;
      if (room.o2 < 0.2 && !stats.o2Immune) crew.hp -= 3.5 * dt;
    }
    if (crew.hp <= 0) {
      crew.hp = 0;
      crew.dead = true;
      crew.action = "dead";
      crew.path = [];
      fx(G, "crewDie", { side: ship.side, name: crew.name });
    }
  }
}

function tickProjectiles(G, dt) {
  for (const p of G.projectiles) p.t += dt / p.dur;
  const arrived = G.projectiles.filter((p) => p.t >= 1);
  G.projectiles = G.projectiles.filter((p) => p.t < 1);

  for (const p of arrived) {
    const target = G.ships[p.targetSide];
    if (!target) continue;
    // evade?
    const ev = evasion(target);
    if (G._rand.chance(ev / 100)) {
      fx(G, "miss", { side: p.targetSide });
      continue;
    }
    // shields absorb lasers
    if (p.kind !== "missile" && target.shieldLayers > 0) {
      target.shieldLayers--;
      fx(G, "hitShield", { side: p.targetSide });
      continue;
    }
    // hull hit
    target.hull -= p.dmg;
    const room = target.rooms.find((r) => r.id === p.room);
    const def = shipDef(target);
    const defRoom = def.rooms.find((r) => r.id === p.room);
    fx(G, "hitHull", { side: p.targetSide, room: p.room, dmg: p.dmg });
    if (defRoom?.sys) {
      const sys = target.systems[defRoom.sys];
      sys.dmg = Math.min(sys.lvl, sys.dmg + p.dmg);
    }
    if (room) {
      const fireChance = p.kind === "missile" ? 0.38 : 0.22;
      const breachChance = p.kind === "missile" ? 0.3 : 0.08;
      if (G._rand.chance(fireChance) && room.o2 > 0.3) {
        room.fire = Math.min(2, room.fire + 1);
        fx(G, "fireStart", { side: p.targetSide, room: p.room });
      }
      if (G._rand.chance(breachChance)) {
        room.breach = 1;
        fx(G, "breach", { side: p.targetSide, room: p.room });
      }
    }
    // crew standing there get singed
    for (const c of crewInRoom(target, p.room)) {
      c.hp -= 13 * p.dmg * (0.6 + G._rand() * 0.8);
    }
  }
}

// ---------------------------------------------------------------------------
// serialization for co-op snapshots (and debugging)

export function serialize(G) {
  const ship = (s) =>
    s && {
      side: s.side,
      defKey: s.defKey,
      name: s.name,
      hull: s.hull,
      hullMax: s.hullMax,
      reactor: s.reactor,
      systems: s.systems,
      rooms: s.rooms,
      doors: s.doors,
      weapons: s.weapons,
      crew: s.crew,
      shieldLayers: s.shieldLayers,
      shieldCharge: s.shieldCharge,
    };
  return {
    seed: G.seed,
    time: G.time,
    beaconT: G.beaconT,
    paused: G.paused,
    phase: G.phase,
    mapOpen: G.mapOpen,
    scrap: G.scrap,
    sector: G.sector,
    ships: { player: ship(G.ships.player), enemy: ship(G.ships.enemy) },
    projectiles: G.projectiles,
    ftl: G.ftl,
    event: G.event,
    shopStock: G.shopStock,
    over: G.over,
    fx: G.fx,
  };
}

// Client-side: adopt an authoritative snapshot wholesale.
export function applySnapshot(G, snap) {
  Object.assign(G, snap);
}
