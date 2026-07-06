import * as THREE from "three";
import { toonMaterial, addOutline } from "../art/toon.js";
import { makeCrewAvatar } from "../art/character.js";
import { animateAvatar } from "../art/animate.js";
import { roomTiles, stationTile, SYS_INFO, WEAPON_TYPES } from "./defs.js";
import { makeLayout } from "./pathfind.js";

// ============================================================================
// 3D view of one ship: extruded toon hull, per-tile floors, walls with sliding
// doors, glowing consoles, system icons, shield bubble, engine flames — and
// the goo crew walking around inside. Reads sim state every frame; owns no
// gameplay logic.
// ============================================================================

const TILE = 1;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function iconTexture(text, color = "#cfe4ff") {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = "44px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 36);
  return new THREE.CanvasTexture(c);
}

export class ShipView {
  constructor(scene, def, side, fxPool) {
    this.scene = scene;
    this.def = def;
    this.side = side;
    this.fx = fxPool;
    this.layout = makeLayout(def);
    this.group = new THREE.Group();
    scene.add(this.group);

    // center the tile grid on the group origin
    const b = this.layout.bounds;
    this.originX = -(b.minX + b.maxX) / 2;
    this.originZ = -(b.minY + b.maxY) / 2;

    this.roomFloor = new Map(); // roomId -> {tiles:[mesh], baseColor}
    this.doorMeshes = new Map(); // doorId -> {group, panels, door}
    this.sysIcons = new Map(); // sys -> sprite
    this.stations = new Map(); // roomId -> console group
    this.breachMeshes = new Map(); // roomId -> mesh
    this.avatars = new Map(); // crewId -> avatar + display state
    this.pickables = [];
    this.fireT = 0;
    this.hitFlash = 0;
    this.deadT = 0;

    this._buildHull();
    this._buildRooms();
    this._buildDoors();
    this._buildShield();

    if (side === "enemy") this.group.rotation.y = Math.PI; // nose faces the player
  }

  tileWorld(x, y, out = new THREE.Vector3()) {
    out.set(x + this.originX, 0, y + this.originZ);
    return this.group.localToWorld(out);
  }

  tileLocal(x, y, out = new THREE.Vector3()) {
    return out.set(x + this.originX, 0, y + this.originZ);
  }

  roomWorldCenter(roomId, out = new THREE.Vector3()) {
    const room = this.layout.rooms.get(roomId);
    const c = this.layout.roomCenter(room);
    return this.tileWorld(c.x, c.y, out).add(new THREE.Vector3(0, 0.35, 0));
  }

  // weapon muzzle: nose-ward edge of the weapons room (or ship nose)
  mountPoint(wi, out = new THREE.Vector3()) {
    const room = this.def.rooms.find((r) => r.sys === "weapons") || this.def.rooms[0];
    const c = this.layout.roomCenter(room);
    return this.tileWorld(c.x + 1.2, c.y - 0.6 + (wi % 3) * 0.6, out).add(new THREE.Vector3(0, 0.4, 0));
  }

  _buildHull() {
    const b = this.layout.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const pad = 0.55;

    // hull silhouette: rounded plate + nose wedge, extruded (three.js Shapes!)
    const shape = new THREE.Shape();
    const x0 = -w / 2 - pad, x1 = w / 2 + pad;
    const z0 = -h / 2 - pad, z1 = h / 2 + pad;
    const r = 0.8;
    const nose = 1.5;
    shape.moveTo(x0 + r, z0);
    shape.lineTo(x1 - 0.2, z0);
    shape.quadraticCurveTo(x1 + nose * 0.7, z0 + h * 0.18, x1 + nose, 0);
    shape.quadraticCurveTo(x1 + nose * 0.7, z1 - h * 0.18, x1 - 0.2, z1);
    shape.lineTo(x0 + r, z1);
    shape.quadraticCurveTo(x0 - 0.5, z1, x0 - 0.5, z1 - r);
    shape.lineTo(x0 - 0.5, z0 + r);
    shape.quadraticCurveTo(x0 - 0.5, z0, x0 + r, z0);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.22, bevelSegments: 2 });
    geo.rotateX(Math.PI / 2);
    const color = this.side === "player" ? 0x4a5a8c : 0x8c4a55;
    const hull = new THREE.Mesh(geo, toonMaterial(color));
    hull.position.y = 0.12;
    addOutline(hull, 0.035);
    this.group.add(hull);
    this.hullMesh = hull;

    // engine nacelles + flame quads at the tail
    this.engineFlames = [];
    for (const dz of [-h * 0.28, h * 0.28]) {
      const nac = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.2, 4, 10), toonMaterial(color === 0x4a5a8c ? 0x37456e : 0x6e3742));
      nac.rotation.z = Math.PI / 2;
      nac.position.set(x0 - 0.7, 0.1, dz);
      addOutline(nac, 0.03);
      this.group.add(nac);

      const flameMat = new THREE.SpriteMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const flame = new THREE.Sprite(flameMat);
      flame.position.set(x0 - 1.6, 0.1, dz);
      flame.scale.set(1.1, 0.5, 1);
      this.group.add(flame);
      this.engineFlames.push(flame);
    }

    // cockpit dome at the nose
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), toonMaterial(0x9fdcff));
    dome.scale.set(1.1, 0.7, 0.9);
    dome.position.set(x1 + 0.55, 0.35, 0);
    addOutline(dome, 0.03);
    this.group.add(dome);
  }

  _buildRooms() {
    const floorGeo = new THREE.BoxGeometry(0.94, 0.1, 0.94);
    const wallGeo = new THREE.BoxGeometry(1.0, 0.46, 0.09);
    const stubGeo = new THREE.BoxGeometry(0.3, 0.46, 0.09);
    const wallMat = toonMaterial(0x232c4a);
    const edges = new Set();
    const doorEdges = new Set(this.layout.doors.map((d) => `${d.dir}:${d.x},${d.y}`));

    for (const roomDef of this.def.rooms) {
      const tiles = [];
      const baseColor = new THREE.Color(roomDef.sys ? 0x39445f : 0x323a52);
      for (const t of roomTiles(roomDef)) {
        const mat = toonMaterial(baseColor.getHex());
        const m = new THREE.Mesh(floorGeo, mat);
        this.tileLocal(t.x, t.y, m.position);
        m.position.y = 0.32;
        m.userData = { type: "room", room: roomDef.id, ship: this.side, tx: t.x, ty: t.y };
        this.group.add(m);
        tiles.push(m);
        this.pickables.push(m);

        // walls on room boundaries (dedup edges, skip door slots)
        const sides = [
          { dir: "v", ex: t.x, ey: t.y, dx: -0.5, dz: 0, rot: Math.PI / 2, other: [t.x - 1, t.y] },
          { dir: "v", ex: t.x + 1, ey: t.y, dx: 0.5, dz: 0, rot: Math.PI / 2, other: [t.x + 1, t.y] },
          { dir: "h", ex: t.x, ey: t.y, dx: 0, dz: -0.5, rot: 0, other: [t.x, t.y - 1] },
          { dir: "h", ex: t.x, ey: t.y + 1, dx: 0, dz: 0.5, rot: 0, other: [t.x, t.y + 1] },
        ];
        for (const s of sides) {
          const otherRoom = this.layout.roomAt(s.other[0], s.other[1]);
          if (otherRoom === roomDef.id) continue; // interior of same room
          const key = `${s.dir}:${s.ex},${s.ey}`;
          if (edges.has(key)) continue;
          edges.add(key);
          const hasDoor = doorEdges.has(key);
          if (hasDoor) {
            // two stubs framing the doorway
            for (const off of [-0.36, 0.36]) {
              const stub = new THREE.Mesh(stubGeo, wallMat);
              this.tileLocal(t.x, t.y, stub.position);
              stub.position.x += s.dx + (s.dir === "h" ? off : 0);
              stub.position.z += s.dz + (s.dir === "v" ? off : 0);
              stub.position.y = 0.55;
              stub.rotation.y = s.rot;
              this.group.add(stub);
            }
          } else {
            const wall = new THREE.Mesh(wallGeo, wallMat);
            this.tileLocal(t.x, t.y, wall.position);
            wall.position.x += s.dx;
            wall.position.z += s.dz;
            wall.position.y = 0.55;
            wall.rotation.y = s.rot;
            this.group.add(wall);
          }
        }
      }
      this.roomFloor.set(roomDef.id, { tiles, baseColor });

      // console + icon for system rooms
      if (roomDef.sys) {
        const st = stationTile(roomDef);
        const c = this.layout.roomCenter(roomDef);
        const consoleGroup = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.2), toonMaterial(0x2a3352));
        body.position.y = 0.5;
        const screen = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.18, 0.03),
          new THREE.MeshBasicMaterial({ color: 0x6fe8ff }),
        );
        screen.position.set(0, 0.66, 0.06);
        screen.rotation.x = -0.5;
        consoleGroup.add(body, screen);
        this.tileLocal(st.x, st.y, consoleGroup.position);
        // push console to the tile edge away from room center
        const away = _v.set(st.x - c.x, 0, st.y - c.y);
        if (away.lengthSq() < 0.01) away.set(-1, 0, -1);
        away.normalize().multiplyScalar(0.31);
        consoleGroup.position.x += away.x;
        consoleGroup.position.z += away.z;
        consoleGroup.lookAt(_v2.copy(consoleGroup.position).sub(away));
        this.group.add(consoleGroup);
        this.stations.set(roomDef.id, { group: consoleGroup, screen });

        const info = SYS_INFO[roomDef.sys];
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: iconTexture(info.icon), transparent: true, depthWrite: false }),
        );
        this.tileLocal(c.x, c.y, sprite.position);
        sprite.position.y = 1.15;
        sprite.scale.set(0.55, 0.55, 1);
        this.group.add(sprite);
        this.sysIcons.set(roomDef.sys, sprite);
      }
    }
  }

  _buildDoors() {
    const panelGeo = new THREE.BoxGeometry(0.34, 0.4, 0.07);
    for (const door of this.layout.doors) {
      const g = new THREE.Group();
      const isAirlock = door.b === "space";
      const mat = toonMaterial(isAirlock ? 0x8c5a2a : 0x5a6a9c);
      const p1 = new THREE.Mesh(panelGeo, mat);
      const p2 = new THREE.Mesh(panelGeo, mat);
      p1.position.x = -0.17;
      p2.position.x = 0.17;
      g.add(p1, p2);
      // position on the shared edge
      if (door.dir === "v") {
        this.tileLocal(door.x - 0.5, door.y, g.position);
        g.rotation.y = Math.PI / 2;
      } else {
        this.tileLocal(door.x, door.y - 0.5, g.position);
      }
      g.position.y = 0.55;
      // invisible fat hitbox for clicking
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData = { type: "door", id: door.id, ship: this.side };
      g.add(hit);
      if (this.side === "player") this.pickables.push(hit);
      this.group.add(g);
      this.doorMeshes.set(door.id, { group: g, p1, p2, door, open: 0 });
    }
  }

  _buildShield() {
    const b = this.layout.bounds;
    const w = b.maxX - b.minX + 3.4;
    const h = b.maxY - b.minY + 3.0;
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x59d8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide, // only the far rim reads, like a thin bubble
    });
    this.shield = new THREE.Mesh(geo, mat);
    this.shield.scale.set(w / 2 + 0.3, 1.5, h / 2 + 0.6);
    this.shield.position.y = 0.4;
    this.group.add(this.shield);
    this.shieldRadius = Math.max(w, h) / 2;
  }

  // ------------------------------------------------------------------ update

  update(dt, ship, time, paused) {
    if (!ship) return;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);

    // room floors: o2 tint + fire glow + damage pulse
    for (const roomState of ship.rooms) {
      const fl = this.roomFloor.get(roomState.id);
      if (!fl) continue;
      const airless = 1 - roomState.o2;
      for (const tile of fl.tiles) {
        const c = tile.material.color;
        c.copy(fl.baseColor);
        // vacuum drains the room toward cold dark blue
        c.lerp(_col.set(0x141a30), airless * 0.75);
        if (roomState.fire > 0) c.lerp(_col.set(0xa8501e), Math.min(1, roomState.fire * 0.4) * (0.7 + Math.sin(time * 9) * 0.3));
      }
    }

    // fire + breach particles (throttled)
    this.fireT -= dt;
    if (this.fireT <= 0 && !paused) {
      this.fireT = 0.06;
      for (const roomState of ship.rooms) {
        if (roomState.fire > 0.05) {
          const room = this.layout.rooms.get(roomState.id);
          const c = this.layout.roomCenter(room);
          const p = this.tileWorld(c.x + (Math.random() - 0.5) * room.w * 0.7, c.y + (Math.random() - 0.5) * room.h * 0.7);
          p.y = 0.42;
          this.fx.flame(p, Math.min(1.4, 0.5 + roomState.fire * 0.5));
        }
        if (roomState.breach > 0.05 && Math.random() < 0.5) {
          const room = this.layout.rooms.get(roomState.id);
          const c = this.layout.roomCenter(room);
          const p = this.tileWorld(c.x, c.y);
          p.y = 0.45;
          this.fx.airPuff(p);
        }
      }
    }

    // breach decals
    for (const roomState of ship.rooms) {
      let mesh = this.breachMeshes.get(roomState.id);
      if (roomState.breach > 0.02 && !mesh) {
        mesh = new THREE.Mesh(
          new THREE.CircleGeometry(0.22, 8),
          new THREE.MeshBasicMaterial({ color: 0x05060a }),
        );
        mesh.rotation.x = -Math.PI / 2;
        const room = this.layout.rooms.get(roomState.id);
        const c = this.layout.roomCenter(room);
        this.tileLocal(c.x + (Math.random() - 0.5) * 0.5, c.y + (Math.random() - 0.5) * 0.5, mesh.position);
        mesh.position.y = 0.385;
        this.group.add(mesh);
        this.breachMeshes.set(roomState.id, mesh);
      } else if (roomState.breach <= 0.02 && mesh) {
        this.group.remove(mesh);
        this.breachMeshes.delete(roomState.id);
      }
    }

    // doors slide
    for (const dm of this.doorMeshes.values()) {
      const state = ship.doors.find((d) => d.id === dm.door.id);
      const target = state && (state.open || state.crewT > 0) ? 1 : 0;
      dm.open += (target - dm.open) * Math.min(1, dt * 10);
      dm.p1.position.x = -0.17 - dm.open * 0.3;
      dm.p2.position.x = 0.17 + dm.open * 0.3;
      if (state) {
        dm.p1.material.color.setHex(dm.door.b === "space" ? (state.open ? 0xd8542e : 0x8c5a2a) : 0x5a6a9c);
      }
    }

    // system icons: tint by damage, bounce when broken
    for (const [sysName, sprite] of this.sysIcons) {
      const sys = ship.systems[sysName];
      if (!sys) continue;
      const frac = sys.lvl > 0 ? sys.dmg / sys.lvl : 0;
      const mat = sprite.material;
      if (frac > 0.99) {
        mat.color.setHex(0xff5d5d);
        sprite.position.y = 1.15 + Math.sin(time * 7) * 0.06;
      } else if (frac > 0.3) {
        mat.color.setHex(0xffb84b);
        sprite.position.y = 1.15;
      } else {
        mat.color.setHex(0xffffff);
        sprite.position.y = 1.15;
      }
      mat.opacity = 0.75 + Math.sin(time * 2 + sysName.length) * 0.1;
    }

    // shield bubble
    const layers = ship.shieldLayers;
    const targetOp = layers > 0 ? 0.035 + layers * 0.03 : 0;
    this.shield.material.opacity += (targetOp - this.shield.material.opacity) * Math.min(1, dt * 6);
    this.shield.material.color.setHSL(0.53, 0.9, 0.55 + Math.sin(time * 2.4) * 0.06);
    this.shield.visible = this.shield.material.opacity > 0.01;

    // engine flames flicker with engine power
    const eng = ship.systems.engines;
    const englvl = eng ? Math.max(0.15, Math.min(eng.power / 3, 1.4)) : 0.15;
    for (const f of this.engineFlames) {
      f.scale.set(englvl * (1.1 + Math.sin(time * 21 + f.position.z) * 0.25), 0.42 * englvl + 0.1, 1);
      f.material.opacity = 0.55 + Math.random() * 0.3;
    }

    // hull flash on hit
    this.hullMesh.material.emissive ??= new THREE.Color(0);
    this.hullMesh.material.emissive.setScalar(this.hitFlash * 0.5);

    this._updateCrew(dt, ship, time, paused);
  }

  _updateCrew(dt, ship, time, paused) {
    const seen = new Set();
    for (const crew of ship.crew) {
      seen.add(crew.id);
      let av = this.avatars.get(crew.id);
      if (!av) {
        av = makeCrewAvatar(crew.species, crew.color, crew.id.charCodeAt(1) || 0);
        av.group.scale.setScalar(1.22); // crew read better slightly oversized
        av.display = { x: crew.x, y: crew.y, heading: this.side === "enemy" ? Math.PI : 0, speed: 0 };
        // selection ring
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.3, 0.38, 24),
          new THREE.MeshBasicMaterial({ color: 0x4be0e8, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        ring.visible = false;
        av.group.add(ring);
        av.selRing = ring;
        // click hitbox
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 0.5;
        hit.userData = { type: "crew", id: crew.id, ship: this.side };
        av.group.add(hit);
        if (this.side === "player") this.pickables.push(hit);
        this.group.add(av.group);
        this.avatars.set(crew.id, av);
      }

      // smooth display position toward sim position (also smooths snapshots)
      const d = av.display;
      const dx = crew.x - d.x;
      const dy = crew.y - d.y;
      const dist = Math.hypot(dx, dy);
      const lerp = Math.min(1, dt * 8);
      d.x += dx * lerp;
      d.y += dy * lerp;
      const vx = (dx * lerp) / Math.max(dt, 1e-4);
      const vy = (dy * lerp) / Math.max(dt, 1e-4);
      const spd = Math.hypot(vx, vy);
      d.speed += (spd - d.speed) * Math.min(1, dt * 10);
      if (dist > 0.04 && spd > 0.05) {
        // heading in ship-local tile space: +x tiles → local +x, +y tiles → local +z
        d.heading = Math.atan2(dx, dy);
      }

      this.tileLocal(d.x, d.y, av.group.position);
      av.group.position.y = 0.38;
      av.group.rotation.y = d.heading;

      // pose from sim action
      const pose = av.pose;
      pose.speed = crew.dead ? 0 : d.speed;
      pose.heading = d.heading;
      if (crew.dead) pose.mode = "dead";
      else if (crew.path.length || d.speed > 0.25) pose.mode = "walk";
      else if (crew.action === "repair" || crew.action === "breach") pose.mode = "repair";
      else if (crew.action === "douse") pose.mode = "douse";
      else if (crew.action === "man" || crew.action === "heal") pose.mode = "work";
      else pose.mode = "idle";

      // face the console while working
      if (pose.mode === "work" || pose.mode === "repair") {
        const roomId = this.layout.roomAt(crew.x, crew.y);
        const st = this.stations.get(roomId);
        if (st) {
          _v.copy(st.group.position).sub(av.group.position);
          d.heading += (Math.atan2(_v.x, _v.z) - d.heading) * Math.min(1, dt * 6);
        }
      }

      av.selRing.visible = !!crew._selected && !crew.dead;
      if (av.selRing.visible) {
        av.selRing.scale.setScalar(1 + Math.sin(time * 5) * 0.08);
      }

      if (!paused) animateAvatar(av, dt, time);

      // work particles
      if (!paused && Math.random() < dt * 8) {
        if (pose.mode === "douse") {
          _v.set(Math.sin(d.heading), 0.6, Math.cos(d.heading));
          this.fx.douseSpray(av.group.getWorldPosition(_v2).add(new THREE.Vector3(0, 0.4, 0)), _v);
        } else if (pose.mode === "repair" && Math.random() < 0.5) {
          this.fx.sparks(av.group.getWorldPosition(_v2).add(new THREE.Vector3(Math.sin(d.heading) * 0.3, 0.35, Math.cos(d.heading) * 0.3)), 2, 0xaad8ff);
        } else if (crew.action === "heal" && Math.random() < 0.4) {
          this.fx.healSpark(av.group.getWorldPosition(_v2));
        }
      }
    }

    // remove avatars for crew that no longer exist
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) {
        this.group.remove(av.group);
        this.avatars.delete(id);
      }
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

const _col = new THREE.Color();
