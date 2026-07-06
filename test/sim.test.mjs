// Headless simulation smoke test: run whole fights at 30Hz with random-ish
// player commands and make sure the sim stays sane (no NaN, hulls fall,
// fights resolve, serialization round-trips).
import assert from "node:assert";
import { newGame, tick, applyCommand, serialize, startCombat, evasion, maxShields } from "../src/game/state.js";
import { aiThink } from "../src/game/ai.js";
import { makeRng } from "../src/core/rng.js";

function checkFinite(obj, path = "G") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `${path} is ${obj}`);
    return;
  }
  if (typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("_")) continue;
    checkFinite(v, `${path}.${k}`);
  }
}

// --------------------------------------------------------- basic construction
{
  const G = newGame(1234);
  assert.equal(G.ships.player.crew.length, 3);
  assert.ok(G.sector.nodes.length >= 7, "sector should have beacons");
  assert.ok(G.sector.nodes.some((n) => n.type === "boss"), "sector needs a boss");
  // every non-start node reachable walking columns forward
  const reach = new Set([G.sector.at]);
  for (let c = 0; c < G.sector.cols; c++) {
    for (const [a, b] of G.sector.edges) {
      if (reach.has(a)) reach.add(b);
    }
  }
  const missing = G.sector.nodes.filter((n) => !reach.has(n.id));
  assert.equal(missing.length, 0, `unreachable beacons: ${missing.map((n) => n.id)}`);
  console.log("sector generation ok:", G.sector.nodes.map((n) => n.type).join(","));
}

// --------------------------------------------------------------- full combat
for (const enemy of ["scout", "fighter", "raider", "boss"]) {
  const G = newGame(42 + enemy.length);
  const cmdRand = makeRng(7);
  startCombat(G, enemy);
  // send crew to stations
  const P = G.ships.player;
  applyCommand(G, { k: "move", crew: P.crew[0].id, room: "pilot" });
  applyCommand(G, { k: "move", crew: P.crew[1].id, room: "weapons" });
  applyCommand(G, { k: "move", crew: P.crew[2].id, room: "shields" });
  applyCommand(G, { k: "wtarget", wi: 0, room: "weapons" });
  applyCommand(G, { k: "wtarget", wi: 1, room: "shields" });

  const dt = 1 / 30;
  let t = 0;
  let aiT = 0;
  let sawProjectile = false;
  let sawShieldOrHit = false;
  while (t < 400 && G.ships.enemy && !G.over) {
    tick(G, dt);
    t += dt;
    if (G.projectiles.length) sawProjectile = true;
    if (G.fx.some((f) => f.k === "hitShield" || f.k === "hitHull")) sawShieldOrHit = true;
    // let the enemy-captain brain also play the player side, like a human would
    aiT -= dt;
    if (aiT <= 0 && G.ships.enemy) {
      aiT = 4;
      aiThink(G, P, G.ships.enemy);
      // plus the occasional nervous manual poke through the real command path
      applyCommand(G, { k: "power", sys: cmdRand.pick(["shields", "engines", "weapons", "medbay"]), delta: cmdRand.chance(0.5) ? 1 : -1 });
    }
    if (Math.floor(t * 30) % 90 === 0) checkFinite(serialize(G));
  }
  assert.ok(sawProjectile, `${enemy}: projectiles should fly`);
  assert.ok(sawShieldOrHit, `${enemy}: something should get hit`);
  assert.ok(!G.ships.enemy || G.over, `${enemy}: fight should resolve within 400s (enemy hull ${G.ships.enemy?.hull})`);
  const result = G.over ? (G.over.win ? "WIN" : `LOSS (${G.over.reason})`) : G.ships.enemy === null ? "enemy destroyed" : "??";
  console.log(`combat vs ${enemy}: resolved in ${t.toFixed(0)}s -> ${result}, hull ${G.ships.player.hull}/${G.ships.player.hullMax}, scrap ${G.scrap}`);
  checkFinite(serialize(G));
}

// -------------------------------------------------- fire / breach / o2 chaos
{
  const G = newGame(99);
  const P = G.ships.player;
  P.rooms.find((r) => r.id === "weapons").fire = 2;
  P.rooms.find((r) => r.id === "engines").breach = 1;
  // vent everything like a panicking player…
  for (const d of P.doors) d.open = true;
  const dt = 1 / 30;
  for (let t = 0; t < 20; t += dt) tick(G, dt);
  // …then remember to close the doors so life support can win
  for (const d of P.doors) d.open = false;
  for (let t = 0; t < 60; t += dt) tick(G, dt);
  checkFinite(serialize(G));
  const weapons = P.rooms.find((r) => r.id === "weapons");
  assert.ok(weapons.fire === 0, `venting + crew should kill the fire (fire=${weapons.fire})`);
  const alive = P.crew.filter((c) => !c.dead).length;
  assert.ok(alive >= 2, `venting shouldn't be a death sentence once doors close (alive=${alive})`);
  const avgO2 = P.rooms.reduce((s, r) => s + r.o2, 0) / P.rooms.length;
  assert.ok(avgO2 > 0.5, `life support should recover (avg o2 ${avgO2.toFixed(2)})`);
  console.log("fire/breach/vent chaos ok; crew alive:", alive, "o2:", P.rooms.map((r) => r.o2.toFixed(2)).join(","));
}

// ------------------------------------------------------------- serialization
{
  const G = newGame(5);
  startCombat(G, "fighter");
  for (let i = 0; i < 300; i++) tick(G, 1 / 30);
  const snap = JSON.parse(JSON.stringify(serialize(G)));
  assert.equal(typeof snap.ships.player.hull, "number");
  assert.ok(Array.isArray(snap.ships.player.crew));
  assert.ok(snap.fx.length > 0, "fx events should accumulate");
  console.log("serialization ok, snapshot size:", JSON.stringify(snap).length, "bytes");
}

// --------------------------------------------------------------- event flow
{
  const G = newGame(11);
  // simulate arriving at an event beacon via command path
  G.ftl = 1;
  applyCommand(G, { k: "jump" });
  assert.ok(G.mapOpen, "jump should open the map");
  const here = G.sector.nodes.find((n) => n.id === G.sector.at);
  const nextIds = G.sector.edges.filter(([a]) => a === here.id).map(([, b]) => b);
  assert.ok(nextIds.length > 0, "start beacon must link forward");
  applyCommand(G, { k: "choose", node: nextIds[0] });
  assert.equal(G.sector.at, nextIds[0], "jump should move the ship");
  assert.equal(G.ftl, 0, "jump should spend the drive charge");
  if (G.event) {
    applyCommand(G, { k: "evchoice", i: 0 });
    assert.ok(G.event.resolved, "event choice should resolve");
    applyCommand(G, { k: "evclose" });
    assert.ok(!G.event || G.phase === "combat", "event should close (or start a fight)");
  }
  if (G.shopStock) {
    const before = G.scrap;
    applyCommand(G, { k: "buy", i: 0 });
    assert.ok(G.scrap <= before, "buying should cost scrap");
    applyCommand(G, { k: "shopClose" });
  }
  console.log(`event flow ok (landed on ${G.sector.nodes.find((n) => n.id === G.sector.at).type})`);
}

console.log("sim.test: all good");
