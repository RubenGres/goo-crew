// Tile-graph pathfinding over a ship layout (node-safe, no three.js).
// Crew move tile-to-tile; crossing a room boundary requires a door there
// (crew shoulder doors open as they pass — doors only gate air, not people).

import { roomTiles, computeDoors, stationTile, roomCenter } from "./defs.js";

export function makeLayout(def) {
  const rooms = new Map(def.rooms.map((r) => [r.id, r]));
  const roomAt = new Map();
  for (const r of def.rooms) {
    for (const t of roomTiles(r)) roomAt.set(`${t.x},${t.y}`, r.id);
  }
  const doors = computeDoors(def);
  // door lookup by the edge it sits on
  const doorAt = new Map();
  for (const d of doors) doorAt.set(`${d.dir}:${d.x},${d.y}`, d);

  // adjacency between rooms (for O2 diffusion)
  const roomDoors = new Map(def.rooms.map((r) => [r.id, []]));
  for (const d of doors) {
    if (roomDoors.has(d.a)) roomDoors.get(d.a).push(d);
    if (d.b !== "space" && roomDoors.has(d.b)) roomDoors.get(d.b).push(d);
  }

  const neighbors = (x, y) => {
    const here = roomAt.get(`${x},${y}`);
    if (!here) return [];
    const out = [];
    const cand = [
      { x: x + 1, y, edge: `v:${x + 1},${y}` },
      { x: x - 1, y, edge: `v:${x},${y}` },
      { x, y: y + 1, edge: `h:${x},${y + 1}` },
      { x, y: y - 1, edge: `h:${x},${y}` },
    ];
    for (const c of cand) {
      const there = roomAt.get(`${c.x},${c.y}`);
      if (!there) continue;
      if (there === here) {
        out.push({ x: c.x, y: c.y, door: null });
      } else {
        const door = doorAt.get(c.edge);
        if (door) out.push({ x: c.x, y: c.y, door });
      }
    }
    return out;
  };

  const path = (fx, fy, tx, ty) => {
    fx = Math.round(fx); fy = Math.round(fy);
    if (fx === tx && fy === ty) return [];
    const key = (x, y) => `${x},${y}`;
    const prev = new Map([[key(fx, fy), null]]);
    const queue = [[fx, fy]];
    while (queue.length) {
      const [x, y] = queue.shift();
      if (x === tx && y === ty) {
        const out = [];
        let k = key(tx, ty);
        let cur = [tx, ty];
        while (k && prev.get(k)) {
          out.unshift({ x: cur[0], y: cur[1] });
          cur = prev.get(k);
          k = cur ? key(cur[0], cur[1]) : null;
        }
        return out;
      }
      for (const n of neighbors(x, y)) {
        const nk = key(n.x, n.y);
        if (!prev.has(nk)) {
          prev.set(nk, [x, y]);
          queue.push([n.x, n.y]);
        }
      }
    }
    return null; // unreachable
  };

  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of def.rooms) {
    bounds.minX = Math.min(bounds.minX, r.x);
    bounds.minY = Math.min(bounds.minY, r.y);
    bounds.maxX = Math.max(bounds.maxX, r.x + r.w);
    bounds.maxY = Math.max(bounds.maxY, r.y + r.h);
  }

  return {
    def,
    rooms,
    roomAt: (x, y) => roomAt.get(`${Math.round(x)},${Math.round(y)}`) ?? null,
    doors,
    doorAt: (dir, x, y) => doorAt.get(`${dir}:${x},${y}`) ?? null,
    roomDoors: (id) => roomDoors.get(id) ?? [],
    neighbors,
    path,
    bounds,
    stationTile,
    roomCenter,
  };
}

// choose a standing tile in a room, avoiding tiles other crew claimed
export function pickTile(layout, roomId, claimed, preferStation = false) {
  const room = layout.rooms.get(roomId);
  if (!room) return null;
  const tiles = roomTiles(room);
  if (preferStation) {
    const st = stationTile(room);
    tiles.sort((a, b) => (Math.abs(a.x - st.x) + Math.abs(a.y - st.y)) - (Math.abs(b.x - st.x) + Math.abs(b.y - st.y)));
  }
  for (const t of tiles) {
    if (!claimed.has(`${t.x},${t.y}`)) return t;
  }
  return tiles[0];
}
