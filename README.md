# 🍜 STAR SLOP

A totally different game living in this repo: an **FTL-like co-op roguelike**
built with Three.js, crewed by procedurally generated **seamless goo
characters**. Solo or 2-player peer-to-peer, in the browser, no install.

> Keep the soup flying. Order the crew, split the reactor, aim the guns,
> vent the fires, jump before the hull gives out.

## The game

You (and optionally a co-captain) run the **SS LADLE** across a hostile
sector, beacon by beacon, to a boss called **MOTHER SPOON**.

- **Real-time ship sim** — reactor power allocation across shields / engines /
  weapons / oxygen / medbay / helm; system damage, fires that spread and eat
  oxygen, hull breaches, room-by-room O₂, venting via airlocks (open the doors,
  space does the firefighting, close them before your crew turns blue).
- **Crew orders** — click a crew member, click a room. They pathfind through
  doors, man stations, repair, fight fires, heal in the medbay. Species matter:
  the Gloop smothers fires, the Skitter sprints, BOLT-E doesn't breathe.
- **Ship-to-ship combat** — charge weapons, target specific enemy rooms, punch
  through shield layers (or lob a Dumpling missile straight past them). The
  enemy ship has its own goo crew running repairs against you.
- **Roguelike run** — 7-column sector map, fights, elites, silly events, a
  trading post, scrap economy, permadeath, boss at the exit.
- **Co-op** — host opens a 4-letter room over WebRTC (PeerJS public broker);
  the partner joins from the menu. Host-authoritative: partner streams
  commands, host streams snapshots. Both captains command everything; you can
  see each other's cursor. Chaos is a feature.

## The tech-art experiment: GOO characters

The crew are the point. Each species is authored as ~10 primitive spheres and
capsules — the classic "AI can compose primitives" workflow — but instead of
rendering primitives with ugly intersections, they're **fused into one
seamless body** at generation time:

1. every primitive is a signed distance function (SDF)
2. primitives blend with a **polynomial smooth-min**, melting joints together
3. the field is polygonized once with **marching tetrahedra** (~100 lines, no
   lookup tables)
4. normals come from the **SDF gradient**, so shading is perfectly smooth
   across every blend — no visible seams anywhere
5. **skin weights are derived from each bone's own sub-field**, so the mesh
   deforms exactly where the shapes blend
6. a stepped-gradient toon material + inverted-hull outline sells the style

Runtime cost is one static `SkinnedMesh` per character (9–18k tris) — no
marching cubes at runtime, no raymarching, mobile-friendly.

Animation is 100% procedural (`src/art/animate.js`), no keyframes:

- **walk gait** with phase-offset legs + analytic two-bone IK (works for the
  2-legged Noodler and the 4-legged Skitter with the same code)
- **hop gait** with squash & stretch for the legless Gloop
- **hover bob + velocity tilt** for BOLT-E the float-bot
- arms swing with the gait or IK-reach to consoles; repairing hammers,
  dousing sprays
- a damped **acceleration spring** wobbles the spine/head for the noodle feel,
  plus blinking eyes and a death flop

## Run it

Requires Node.js.

```bash
npm install
npm run dev     # then open http://localhost:5173/
npm run build   # static build into dist/
npm test        # headless tests: goo mesher, IK, full sim, netcode
```

Optional headless smoke test with screenshots (needs Chromium):

```bash
node scripts/screenshot.mjs
```

## Controls

| Input | Action |
| --- | --- |
| Click crew (or card, or `1-8`) | select crew |
| Click room | send selected crew there |
| Click weapon card | arm it, then click an enemy room to target |
| Click door | open/close (open airlocks vent air & fires) |
| Click system icons (bottom) | +1 power · right-click/shift-click −1 |
| `Space` | pause |
| `Esc` | clear selection/targeting |
| JUMP (when FTL charged) | open the sector map |

## Layout

```
  src/
    art/    goo.js (SDF→marching tets→auto-skin) · character.js (species)
            animate.js (procedural gaits + IK) · toon.js (toon + outlines)
    ship/   defs.js (blueprints) · pathfind.js · shipview.js (3D interior)
    game/   state.js (host-authoritative sim) · ai.js · events.js
            hud.js · fx.js (particles) · species.js
    net/    protocol/session/peer (WebRTC via PeerJS) + loopback for tests
    core/   engine.js (renderer/camera/backdrop) · audio.js (procedural) · rng.js
  test/     char.test.mjs · sim.test.mjs · net.test.mjs (all plain node)
```

The simulation (`game/state.js`, `game/ai.js`, `ship/defs.js`,
`ship/pathfind.js`) never imports three.js, so the whole game logic runs and
is tested headlessly in node.
