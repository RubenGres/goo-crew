// Loopback netcode test: handshake, client command -> host sim, host snapshot
// -> client state, all over the in-memory transport pair.
import assert from "node:assert";
import { NetSession } from "../src/net/session.js";
import { createLoopbackPair } from "../src/net/loopback.js";
import { newGame, tick, applyCommand, serialize, applySnapshot } from "../src/game/state.js";

const [trHost, trClient] = createLoopbackPair();

const G = newGame(777);
const clientG = {};
let hostConnected = false;
let clientConnected = false;

const host = new NetSession("host", trHost, {
  onConnect: () => (hostConnected = true),
  onCmd: (cmd) => applyCommand(G, cmd),
});
const client = new NetSession("client", trClient, {
  onConnect: () => (clientConnected = true),
  onSnapshot: (d) => applySnapshot(clientG, d),
});

host.start();
client.start();

await new Promise((r) => setTimeout(r, 50));
assert.ok(hostConnected && clientConnected, "handshake should complete over loopback");

// client orders a crew member around; host applies it
const crewId = G.ships.player.crew[0].id;
client.sendCmd({ k: "move", crew: crewId, room: "medbay" });
await new Promise((r) => setTimeout(r, 30));
assert.equal(G.ships.player.crew[0].destRoom, "medbay", "host should apply client command");

// simulate a bit and snapshot back
for (let i = 0; i < 120; i++) tick(G, 1 / 60);
host.sendSnapshot(serialize(G), { x: 1, z: 2 });
await new Promise((r) => setTimeout(r, 30));
assert.equal(clientG.ships.player.crew[0].destRoom, "medbay", "client should see crew orders in snapshot");
assert.ok(Math.abs(clientG.time - G.time) < 1e-9, "client time should match host");
assert.ok(clientG.sector.nodes.length === G.sector.nodes.length, "sector should round-trip");

host.close();
client.close();
console.log("net.test: all good (handshake, cmd, snapshot)");
process.exit(0);
