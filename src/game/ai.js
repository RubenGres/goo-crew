// Enemy captain: a small utility brain that runs every ~1.25s.
// It distributes power, keeps weapons pointed at juicy player rooms, and
// shuffles its noodle crew between repairs, fires, and stations.

import { shipDef, shipLayout, orderCrewTo, powerUsed } from "./state.js";

const TARGET_PRIORITY = ["weapons", "shields", "pilot", "engines", "oxygen", "medbay"];

export function aiThink(G, ship, foe) {
  const rand = G._rand;

  // ---- power: shields > weapons > engines > oxygen
  const order = ["shields", "weapons", "engines", "oxygen", "medbay", "pilot"];
  for (const s of order) {
    const sys = ship.systems[s];
    if (sys) sys.power = 0;
  }
  let left = ship.reactor;
  for (const s of order) {
    const sys = ship.systems[s];
    if (!sys) continue;
    const usable = Math.max(0, Math.floor(sys.lvl - sys.dmg));
    const want = Math.min(usable, left);
    sys.power = want;
    left -= want;
  }

  // ---- weapon targeting: prefer high-value foe rooms, occasionally switch
  const foeDef = shipDef(foe);
  for (const w of ship.weapons) {
    if (w.target && rand.chance(0.85)) continue;
    for (const sysName of TARGET_PRIORITY) {
      const room = foeDef.rooms.find((r) => r.sys === sysName);
      if (room && rand.chance(0.65)) {
        w.target = room.id;
        break;
      }
    }
    if (!w.target) w.target = rand.pick(foeDef.rooms).id;
  }

  // ---- crew: retreat the badly hurt, fires first, then repairs, then stations
  const layout = shipLayout(ship);
  const def = shipDef(ship);
  const medRoom = def.rooms.find((r) => r.sys === "medbay");
  const busyRooms = new Set();
  const idle = [];
  for (const crew of ship.crew) {
    if (crew.dead) continue;
    const roomId = layout.roomAt(crew.x, crew.y);
    // wounded crew limp to the medbay and stay until patched up
    if (medRoom && ship.systems.medbay && crew.hp < crew.hpMax * 0.4) {
      if (crew.destRoom !== medRoom.id) orderCrewTo(ship, crew, medRoom.id);
      ship.systems.medbay.power = Math.max(ship.systems.medbay.power, 1);
      busyRooms.add(medRoom.id);
      continue;
    }
    if (medRoom && roomId === medRoom.id && crew.hp < crew.hpMax * 0.9 && crew.action !== "repair" && crew.action !== "douse") {
      busyRooms.add(medRoom.id);
      continue; // keep healing
    }
    if (crew.action === "douse" || crew.action === "repair" || crew.action === "breach") {
      busyRooms.add(crew.destRoom || roomId);
      continue;
    }
    if (crew.path.length) {
      busyRooms.add(crew.destRoom);
      continue;
    }
    idle.push(crew);
  }

  const needsHelp = [];
  for (const room of ship.rooms) {
    const defRoom = def.rooms.find((r) => r.id === room.id);
    const sysDmg = defRoom.sys ? ship.systems[defRoom.sys].dmg : 0;
    const score = room.fire * 3 + room.breach * 2 + sysDmg;
    if (score > 0.2 && !busyRooms.has(room.id)) needsHelp.push({ id: room.id, score });
  }
  needsHelp.sort((a, b) => b.score - a.score);

  for (const need of needsHelp) {
    const crew = idle.shift();
    if (!crew) return;
    orderCrewTo(ship, crew, need.id);
    busyRooms.add(need.id);
  }

  // station the rest
  const stations = ["weapons", "pilot", "shields", "engines"];
  for (const sysName of stations) {
    if (!idle.length) return;
    const room = def.rooms.find((r) => r.sys === sysName);
    if (!room || busyRooms.has(room.id)) continue;
    const occupied = ship.crew.some(
      (c) => !c.dead && !c.path.length && layout.roomAt(c.x, c.y) === room.id,
    );
    if (occupied) continue;
    const crew = idle.shift();
    orderCrewTo(ship, crew, room.id);
    busyRooms.add(room.id);
  }
}
