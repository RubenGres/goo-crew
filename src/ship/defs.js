// Ship blueprints. Pure data (node-safe). Grid coords: x grows toward the
// ship's nose, y grows "down" on screen. Rooms are axis-aligned rects of
// tiles; doors are derived automatically between adjacent rooms, airlocks
// where marked. All sizes in tiles (1 tile = 1 world unit).

export const WEAPON_TYPES = {
  laser1: { label: "PEA SHOOTER", shots: 1, dmg: 1, charge: 7, power: 1, kind: "laser", cost: 25 },
  laser2: { label: "TWIN NOODLE", shots: 2, dmg: 1, charge: 11, power: 2, kind: "laser", cost: 45 },
  heavy: { label: "MEAT BEAM", shots: 1, dmg: 2, charge: 13, power: 2, kind: "laser", cost: 55 },
  missile: { label: "DUMPLING", shots: 1, dmg: 2, charge: 14, power: 1, kind: "missile", cost: 50 },
};

export const SYS_INFO = {
  shields: { label: "SHIELDS", icon: "🛡", maxLvl: 6 },
  engines: { label: "ENGINES", icon: "🚀", maxLvl: 5 },
  weapons: { label: "WEAPONS", icon: "🎯", maxLvl: 6 },
  oxygen: { label: "OXYGEN", icon: "🫧", maxLvl: 2 },
  medbay: { label: "MEDBAY", icon: "✚", maxLvl: 2 },
  pilot: { label: "HELM", icon: "🎮", maxLvl: 2 },
};

export const PLAYER_SHIP = {
  key: "ladle",
  name: "SS LADLE",
  hull: 30,
  reactor: 8,
  rooms: [
    { id: "engines", sys: "engines", lvl: 2, x: 0, y: 1, w: 1, h: 2, airlock: "left" },
    { id: "weapons", sys: "weapons", lvl: 3, x: 1, y: 0, w: 2, h: 2 },
    { id: "shields", sys: "shields", lvl: 2, x: 1, y: 2, w: 2, h: 2 },
    { id: "oxygen", sys: "oxygen", lvl: 1, x: 3, y: 0, w: 1, h: 2 },
    { id: "medbay", sys: "medbay", lvl: 1, x: 3, y: 2, w: 1, h: 2 },
    { id: "hall", sys: null, lvl: 0, x: 4, y: 1, w: 1, h: 2, airlock: "top" },
    { id: "pilot", sys: "pilot", lvl: 1, x: 5, y: 1, w: 1, h: 2 },
  ],
  weapons: ["laser2", "missile"],
  crew: [
    { species: "noodler" },
    { species: "gloop" },
    { species: "skitter" },
  ],
};

// Enemy blueprints by menace tier
export const ENEMY_SHIPS = [
  {
    key: "scout",
    name: "GRUBBY SCOUT",
    hull: 9,
    reactor: 5,
    rooms: [
      { id: "engines", sys: "engines", lvl: 1, x: 0, y: 0, w: 1, h: 2 },
      { id: "weapons", sys: "weapons", lvl: 1, x: 1, y: 0, w: 1, h: 1 },
      { id: "shields", sys: "shields", lvl: 2, x: 1, y: 1, w: 1, h: 1 },
      { id: "pilot", sys: "pilot", lvl: 1, x: 2, y: 0, w: 1, h: 2 },
    ],
    weapons: ["laser1"],
    crew: [{ species: "skitter" }, { species: "noodler" }],
    scrap: [14, 24],
  },
  {
    key: "fighter",
    name: "BRINE FIGHTER",
    hull: 14,
    reactor: 7,
    rooms: [
      { id: "engines", sys: "engines", lvl: 2, x: 0, y: 0, w: 1, h: 2 },
      { id: "weapons", sys: "weapons", lvl: 2, x: 1, y: 0, w: 2, h: 1 },
      { id: "shields", sys: "shields", lvl: 2, x: 1, y: 1, w: 2, h: 1 },
      { id: "oxygen", sys: "oxygen", lvl: 1, x: 3, y: 0, w: 1, h: 1 },
      { id: "pilot", sys: "pilot", lvl: 1, x: 3, y: 1, w: 1, h: 1 },
    ],
    weapons: ["laser1", "laser1"],
    crew: [{ species: "noodler" }, { species: "gloop" }, { species: "bolt" }],
    scrap: [20, 32],
  },
  {
    key: "raider",
    name: "SALT RAIDER",
    hull: 18,
    reactor: 9,
    rooms: [
      { id: "engines", sys: "engines", lvl: 2, x: 0, y: 1, w: 1, h: 2 },
      { id: "weapons", sys: "weapons", lvl: 3, x: 1, y: 0, w: 2, h: 2 },
      { id: "shields", sys: "shields", lvl: 4, x: 1, y: 2, w: 2, h: 2 },
      { id: "medbay", sys: "medbay", lvl: 1, x: 3, y: 0, w: 1, h: 2 },
      { id: "pilot", sys: "pilot", lvl: 1, x: 3, y: 2, w: 1, h: 2 },
    ],
    weapons: ["laser2", "missile"],
    crew: [{ species: "skitter" }, { species: "skitter" }, { species: "noodler" }],
    scrap: [28, 44],
  },
  {
    key: "boss",
    name: "MOTHER SPOON",
    hull: 30,
    reactor: 12,
    rooms: [
      { id: "engines", sys: "engines", lvl: 3, x: 0, y: 1, w: 1, h: 3 },
      { id: "weapons", sys: "weapons", lvl: 4, x: 1, y: 0, w: 2, h: 2 },
      { id: "shields", sys: "shields", lvl: 6, x: 1, y: 3, w: 2, h: 2 },
      { id: "hall", sys: null, lvl: 0, x: 1, y: 2, w: 2, h: 1 },
      { id: "oxygen", sys: "oxygen", lvl: 2, x: 3, y: 0, w: 1, h: 2 },
      { id: "medbay", sys: "medbay", lvl: 2, x: 3, y: 3, w: 1, h: 2 },
      { id: "pilot", sys: "pilot", lvl: 2, x: 4, y: 2, w: 1, h: 1 },
    ],
    weapons: ["laser2", "heavy", "missile"],
    crew: [{ species: "noodler" }, { species: "bolt" }, { species: "gloop" }, { species: "skitter" }],
    scrap: [60, 80],
  },
];

// ---------------------------------------------------------------------------
// derived helpers

export function roomTiles(room) {
  const tiles = [];
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) tiles.push({ x: room.x + dx, y: room.y + dy });
  }
  return tiles;
}

export function roomCenter(room) {
  return { x: room.x + room.w / 2 - 0.5, y: room.y + room.h / 2 - 0.5 };
}

// Compute doors between adjacent rooms plus marked airlocks.
// Door: { id, a, b ('space' for airlocks), x, y, dir: 'h'|'v' }
//   dir 'v': door on the vertical edge between tile (x-1,y) and (x,y)
//   dir 'h': door on the horizontal edge between tile (x,y-1) and (x,y)
export function computeDoors(def) {
  const doors = [];
  const seen = new Set();
  const roomAt = new Map();
  for (const r of def.rooms) {
    for (const t of roomTiles(r)) roomAt.set(`${t.x},${t.y}`, r.id);
  }
  for (const r of def.rooms) {
    for (const t of roomTiles(r)) {
      // right neighbor (vertical edge)
      const pairs = [
        { nx: t.x + 1, ny: t.y, dir: "v", ex: t.x + 1, ey: t.y },
        { nx: t.x, ny: t.y + 1, dir: "h", ex: t.x, ey: t.y + 1 },
      ];
      for (const p of pairs) {
        const other = roomAt.get(`${p.nx},${p.ny}`);
        if (other && other !== r.id) {
          const key = [r.id, other].sort().join("|") + p.dir;
          if (seen.has(key)) continue; // one door per room pair per direction
          seen.add(key);
          doors.push({ id: doors.length, a: r.id, b: other, x: p.ex, y: p.ey, dir: p.dir });
        }
      }
    }
    if (r.airlock) {
      const c = roomCenter(r);
      let door;
      if (r.airlock === "left") door = { x: r.x, y: Math.floor(c.y), dir: "v" };
      else if (r.airlock === "right") door = { x: r.x + r.w, y: Math.floor(c.y), dir: "v" };
      else if (r.airlock === "top") door = { x: Math.floor(c.x), y: r.y, dir: "h" };
      else door = { x: Math.floor(c.x), y: r.y + r.h, dir: "h" };
      doors.push({ id: doors.length, a: r.id, b: "space", ...door });
    }
  }
  return doors;
}

// station tile for a system room: the tile crew stand on to "man" the system
export function stationTile(room) {
  return { x: room.x, y: room.y }; // top-left corner, console faces into room
}
