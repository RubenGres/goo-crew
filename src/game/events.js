// Sector generation, beacon events, and shop stock. Node-safe pure data/fns.

import { WEAPON_TYPES, SYS_INFO } from "../ship/defs.js";
import { SPECIES } from "./species.js";

// ---------------------------------------------------------------------------
// sector map: columns of beacons, edges to the next column, boss at the end

export function makeSector(rand) {
  const cols = 7;
  const nodes = [];
  const edges = [];
  let id = 0;
  const colNodes = [];
  for (let c = 0; c < cols; c++) {
    const n = c === 0 || c === cols - 1 ? 1 : rand.int(2, 3);
    const list = [];
    for (let i = 0; i < n; i++) {
      const node = {
        id: `n${id++}`,
        col: c,
        x: c / (cols - 1),
        y: n === 1 ? 0.5 : (i + 0.5) / n + rand.range(-0.08, 0.08),
        type: "empty",
        visited: false,
      };
      nodes.push(node);
      list.push(node);
    }
    colNodes.push(list);
  }

  // types
  colNodes[0][0].type = "start";
  colNodes[0][0].visited = true;
  colNodes[cols - 1][0].type = "boss";
  const enemyForCol = (c) => (c <= 2 ? "scout" : c <= 4 ? "fighter" : "raider");
  const eliteForCol = (c) => (c <= 2 ? "fighter" : c <= 4 ? "raider" : "raider");
  let shops = 0;
  for (let c = 1; c < cols - 1; c++) {
    for (const node of colNodes[c]) {
      const roll = rand();
      if (roll < 0.42) {
        node.type = "fight";
        node.enemy = enemyForCol(c);
      } else if (roll < 0.52) {
        node.type = "elite";
        node.enemy = eliteForCol(c);
      } else if (roll < 0.75) {
        node.type = "event";
        node.event = null; // rolled on arrival
      } else if (roll < 0.87 && shops < 2) {
        node.type = "shop";
        shops++;
      } else {
        node.type = "empty";
      }
    }
  }
  // guarantee at least one shop mid-sector
  if (shops === 0) {
    const c = 3;
    colNodes[c][0].type = "shop";
  }

  // edges: every node links to 1-2 nodes in the next column; every next-col
  // node gets at least one incoming link
  for (let c = 0; c < cols - 1; c++) {
    const next = colNodes[c + 1];
    const covered = new Set();
    for (const node of colNodes[c]) {
      const sorted = [...next].sort((a, b) => Math.abs(a.y - node.y) - Math.abs(b.y - node.y));
      const links = rand.chance(0.55) && next.length > 1 ? 2 : 1;
      for (let i = 0; i < Math.min(links, sorted.length); i++) {
        edges.push([node.id, sorted[i].id]);
        covered.add(sorted[i].id);
      }
    }
    for (const node of next) {
      if (!covered.has(node.id)) {
        const from = colNodes[c].sort((a, b) => Math.abs(a.y - node.y) - Math.abs(b.y - node.y))[0];
        edges.push([from.id, node.id]);
      }
    }
  }

  return { cols, nodes, edges, at: colNodes[0][0].id };
}

// ---------------------------------------------------------------------------
// beacon events: short, silly, consequential

export const EVENTS = [
  {
    id: "derelict",
    title: "DERELICT FREIGHTER",
    text: "A gutted freighter drifts past, cargo doors flapping like a loose jaw. Scanners pick up sealed crates… and faint skittering.",
    choices: [
      {
        label: "Board it and grab the crates",
        out: (G, rand) =>
          rand.chance(0.65)
            ? { scrap: rand.int(15, 30), text: "Crates full of scrap! The skittering was just a very nervous vacuum cleaner." }
            : { crewHp: -35, scrap: 8, text: "The skittering was NOT a vacuum cleaner. The crew escapes with bites and a little scrap." },
      },
      { label: "Scan and move on", out: { scrap: 4, text: "You siphon a little hull plating from a safe distance. Boring, but nobody got bitten." } },
    ],
  },
  {
    id: "soupvendor",
    title: "NOMAD SOUP VENDOR",
    text: "A tiny ship hails you. Its whole hull is a kettle. \"FRESH SOUP,\" the captain bellows. \"GOOD FOR HULL. GOOD FOR SOUL.\"",
    choices: [
      {
        label: "Buy soup (10 scrap)",
        out: (G) =>
          G.scrap >= 10
            ? { scrap: -10, hull: 4, crewHp: 25, text: "The soup is transcendent. Hull dents pop back out. Crew morale (and HP) soars." }
            : { text: "You can't afford soup. The vendor's pity is somehow worse than laser fire." },
      },
      {
        label: "Decline politely",
        out: { text: "The vendor sighs and jets away, leaving a faint smell of broth and disappointment." },
      },
    ],
  },
  {
    id: "stowaway",
    title: "KNOCKING IN THE CARGO HOLD",
    text: "Rhythmic knocking from a supply crate. Something inside is alive, and it knows morse code for 'please'.",
    choices: [
      {
        label: "Open the crate",
        out: (G, rand) => {
          const options = Object.keys(SPECIES);
          const sp = options[rand.int(0, options.length - 1)];
          return { crewAdd: sp, text: `A stowaway ${SPECIES[sp].label} unfolds from the crate and immediately asks where the snacks are. They join the crew!` };
        },
      },
      { label: "Jettison it", out: { scrap: 6, text: "You fire the crate into the void. It knocks reproachfully all the way. The crate itself was worth a few scrap. You monster." } },
    ],
  },
  {
    id: "asteroids",
    title: "SPICY ASTEROID FIELD",
    text: "A dense asteroid field glitters with mineral deposits. Threading it could pay well — or dent something important.",
    choices: [
      {
        label: "Thread the field",
        out: (G, rand) =>
          rand.chance(0.55)
            ? { scrap: rand.int(20, 34), text: "Flawless flying! The cargo bay is full of glittering rock." }
            : { hull: -4, scrap: 10, text: "CLANG. CLANG. The hull takes a drumming, but you scoop some ore on the way out." },
      },
      { label: "Go around", out: { text: "You take the long, boring, dent-free way around." } },
    ],
  },
  {
    id: "distress",
    title: "DISTRESS BEACON",
    text: "\"Mayday! Our reactor is doing the thing again!\" A civilian tug flickers its lights desperately.",
    choices: [
      {
        label: "Help them",
        out: (G, rand) =>
          rand.chance(0.7)
            ? { scrap: rand.int(12, 22), text: "You fix the reactor with percussive maintenance. They pay in scrap and effusive compliments." }
            : { fight: "scout", text: "The 'civilian tug' drops its disguise. Pirates! Battle stations!" },
      },
      { label: "Ignore it", out: { text: "You fly past. Somewhere, a space insurance premium increases." } },
    ],
  },
  {
    id: "casino",
    title: "ORBITAL CASINO WRECK",
    text: "A half-collapsed casino station spins lazily. Its sign still blinks: J CKP T. Security drones offline… probably.",
    choices: [
      {
        label: "Loot the vault",
        out: (G, rand) =>
          rand.chance(0.5)
            ? { scrap: rand.int(28, 45), text: "J CKP T indeed! The vault door was already open. You leave a thank-you note." }
            : { fight: "fighter", text: "The drones were NOT offline. They also unionized. They are very upset." },
      },
      { label: "Salvage the sign", out: { scrap: 9, text: "The neon tubing is worth a bit. Your ship now smells faintly of regret and cocktails." } },
    ],
  },
  {
    id: "nebula",
    title: "WHISPERING NEBULA",
    text: "The nebula ahead hums against the hull. The crew swears it's whispering recipes.",
    choices: [
      {
        label: "Listen closely",
        out: (G, rand) =>
          rand.chance(0.6)
            ? { crewHp: 20, text: "The whispers teach the crew to relax their shoulders. Everyone feels great. The recipe was for broth." }
            : { crewHp: -15, text: "The whispers were mostly static and one extremely rude limerick. Headaches all around." },
      },
      { label: "Shut the blast shutters", out: { text: "You pass through in respectful silence. The nebula sulks." } },
    ],
  },
  {
    id: "mine",
    title: "ABANDONED MINING RIG",
    text: "A mining rig clamps a cracked asteroid like a tick. Its fusion torch still burns. Free fuel — if someone climbs out to get it.",
    choices: [
      {
        label: "Send a spacewalker",
        out: (G, rand) =>
          rand.chance(0.7)
            ? { scrap: rand.int(16, 26), text: "Clean extraction! The torch cell is worth a pile of scrap." }
            : { crewHp: -30, scrap: 12, text: "The torch sputters mid-climb. Singed eyebrows, decent haul." },
      },
      { label: "Leave it", out: { text: "Some free lunches are load-bearing. You move on." } },
    ],
  },
];

export function rollEvent(rand, node) {
  const tpl = EVENTS[rand.int(0, EVENTS.length - 1)];
  return { id: tpl.id, title: tpl.title, text: tpl.text, choices: tpl.choices.map((c) => ({ label: c.label })), resolved: false, result: null };
}

// ---------------------------------------------------------------------------
// shop

export function makeShopStock(G, rand) {
  const stock = [
    { kind: "repair", label: "HULL PATCH (+3)", desc: "Slap 3 hull back on.", cost: 9, n: 3 },
    { kind: "reactor", label: "REACTOR CELL", desc: "+1 reactor power, permanently.", cost: 32 },
  ];
  // two system upgrades
  const sysKeys = Object.keys(G.ships.player.systems);
  for (let i = 0; i < 2 && sysKeys.length; i++) {
    const s = sysKeys.splice(rand.int(0, sysKeys.length - 1), 1)[0];
    const lvl = G.ships.player.systems[s].lvl;
    if (lvl < SYS_INFO[s].maxLvl) {
      stock.push({ kind: "sys", sys: s, label: `${SYS_INFO[s].label} MK${lvl + 1}`, desc: `Upgrade ${SYS_INFO[s].label.toLowerCase()} to level ${lvl + 1}.`, cost: 18 + lvl * 12 });
    }
  }
  // one weapon
  const wKeys = Object.keys(WEAPON_TYPES);
  const wt = wKeys[rand.int(0, wKeys.length - 1)];
  stock.push({ kind: "weapon", type: wt, label: WEAPON_TYPES[wt].label, desc: `Weapon: ${WEAPON_TYPES[wt].shots}×${WEAPON_TYPES[wt].dmg} dmg, ${WEAPON_TYPES[wt].charge}s charge.`, cost: WEAPON_TYPES[wt].cost });
  // one crew
  const spKeys = Object.keys(SPECIES);
  const sp = spKeys[rand.int(0, spKeys.length - 1)];
  stock.push({ kind: "crew", species: sp, label: `HIRE ${SPECIES[sp].label}`, desc: SPECIES[sp].desc, cost: 42 });
  return stock;
}
