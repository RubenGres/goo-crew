import * as THREE from "three";
import { buildGooGeometry } from "./goo.js";
import { toonMaterial, addOutline } from "./toon.js";

// ============================================================================
// Species bodies. Each build() authors a skeleton (named bones with rest
// positions in character space, feet on y=0, facing +Z) and a list of goo
// parts hung on those bones. The goo mesher fuses the parts into one seamless
// skinned body; animate.js drives the bones procedurally.
// ============================================================================

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function mirrorX(defs) {
  // helper: given left-side bone defs, emit the right side with L->R names
  return defs.map((b) => ({
    ...b,
    name: b.name.replace(/L$/, "R"),
    parent: b.parent && b.parent.endsWith("L") ? b.parent.replace(/L$/, "R") : b.parent,
    pos: V(-b.pos.x, b.pos.y, b.pos.z),
  }));
}

function limb(bones, parts, cfgList, { prefix, side, from, mid, end, r1, r2, tip, parent, pole }) {
  const s = side === "L" ? 1 : -1;
  const names = { a: `${prefix}A${side}`, b: `${prefix}B${side}`, c: `${prefix}C${side}` };
  bones.push(
    { name: names.a, parent, pos: from },
    { name: names.b, parent: names.a, pos: mid },
    { name: names.c, parent: names.b, pos: end },
  );
  parts.push(
    { kind: "capsule", a: from.clone(), b: mid.clone(), r: r1, bone: names.a },
    { kind: "capsule", a: mid.clone(), b: end.clone(), r: r2, bone: names.b },
  );
  if (tip) parts.push({ ...tip, bone: names.c });
  cfgList.push({
    upper: names.a,
    lower: names.b,
    endBone: names.c,
    rest: end.clone(),
    side: s,
    pole: pole || V(0, 0, 1),
  });
}

const BUILDS = {
  // ------------------------------------------------- two legs, two arms
  noodler(rng) {
    const bones = [
      { name: "root", parent: null, pos: V(0, 0.37, 0) },
      { name: "spine", parent: "root", pos: V(0, 0.5, 0) },
      { name: "head", parent: "spine", pos: V(0, 0.64, 0) },
    ];
    const belly = rng.range(0.115, 0.135);
    const parts = [
      { kind: "capsule", a: V(0, 0.33, 0), b: V(0, 0.44, 0), r: belly, bone: "root" },
      { kind: "capsule", a: V(0, 0.44, 0), b: V(0, 0.55, 0), r: belly * 0.86, bone: "spine" },
      { kind: "sphere", a: V(0, 0.68, 0), r: rng.range(0.11, 0.125), s: V(1, rng.range(1, 1.15), 0.95), bone: "head" },
    ];
    const legs = [];
    const arms = [];
    limb(bones, parts, arms, {
      prefix: "arm", side: "L", parent: "spine",
      from: V(0.135, 0.53, 0), mid: V(0.16, 0.40, 0), end: V(0.17, 0.28, 0),
      r1: 0.04, r2: 0.037,
      tip: { kind: "sphere", a: V(0.17, 0.27, 0), r: 0.052 },
      pole: V(0.4, -0.3, -1),
    });
    limb(bones, parts, arms, {
      prefix: "arm", side: "R", parent: "spine",
      from: V(-0.135, 0.53, 0), mid: V(-0.16, 0.40, 0), end: V(-0.17, 0.28, 0),
      r1: 0.04, r2: 0.037,
      tip: { kind: "sphere", a: V(-0.17, 0.27, 0), r: 0.052 },
      pole: V(-0.4, -0.3, -1),
    });
    limb(bones, parts, legs, {
      prefix: "leg", side: "L", parent: "root",
      from: V(0.075, 0.36, 0), mid: V(0.078, 0.2, 0), end: V(0.08, 0.055, 0),
      r1: 0.048, r2: 0.045,
      tip: { kind: "sphere", a: V(0.08, 0.05, 0.02), r: 0.06, s: V(1, 0.72, 1.35) },
      pole: V(0, 0, 1),
    });
    limb(bones, parts, legs, {
      prefix: "leg", side: "R", parent: "root",
      from: V(-0.075, 0.36, 0), mid: V(-0.078, 0.2, 0), end: V(-0.08, 0.055, 0),
      r1: 0.048, r2: 0.045,
      tip: { kind: "sphere", a: V(-0.08, 0.05, 0.02), r: 0.06, s: V(1, 0.72, 1.35) },
      pole: V(0, 0, 1),
    });
    return {
      bones, parts, legs, arms,
      mode: "walk",
      head: "head", spine: "spine", root: "root",
      rootRest: 0.37, hipH: 0.36, stride: 0.34,
      eyes: { bone: "head", r: 0.036, offs: [V(0.05, 0.7, 0.095), V(-0.05, 0.7, 0.095)] },
      blend: 0.075,
    };
  },

  // ------------------------------------------------- no legs: hops
  gloop(rng) {
    const bones = [
      { name: "root", parent: null, pos: V(0, 0.2, 0) },
      { name: "crown", parent: "root", pos: V(0, 0.38, 0) },
    ];
    const parts = [
      { kind: "sphere", a: V(0, 0.17, 0), r: rng.range(0.19, 0.215), s: V(1.06, 0.88, 1.06), bone: "root" },
      { kind: "sphere", a: V(0, 0.32, 0), r: 0.14, bone: "root" },
      { kind: "sphere", a: V(0, 0.43, 0), r: 0.095, s: V(1, 1.12, 1), bone: "crown" },
    ];
    const arms = [];
    limb(bones, parts, arms, {
      prefix: "arm", side: "L", parent: "root",
      from: V(0.17, 0.26, 0), mid: V(0.21, 0.17, 0), end: V(0.23, 0.09, 0),
      r1: 0.038, r2: 0.034,
      tip: { kind: "sphere", a: V(0.23, 0.08, 0), r: 0.046 },
      pole: V(0.5, -0.2, -1),
    });
    limb(bones, parts, arms, {
      prefix: "arm", side: "R", parent: "root",
      from: V(-0.17, 0.26, 0), mid: V(-0.21, 0.17, 0), end: V(-0.23, 0.09, 0),
      r1: 0.038, r2: 0.034,
      tip: { kind: "sphere", a: V(-0.23, 0.08, 0), r: 0.046 },
      pole: V(-0.5, -0.2, -1),
    });
    return {
      bones, parts, legs: [], arms,
      mode: "hop",
      head: "crown", spine: "crown", root: "root",
      rootRest: 0.2, stride: 0.5,
      eyes: { bone: "crown", r: 0.034, offs: [V(0.045, 0.44, 0.09), V(-0.045, 0.44, 0.09)] },
      blend: 0.12,
    };
  },

  // ------------------------------------------------- four legs
  skitter(rng) {
    const bones = [
      { name: "root", parent: null, pos: V(0, 0.27, 0) },
      { name: "head", parent: "root", pos: V(0, 0.38, 0.1) },
    ];
    const parts = [
      { kind: "sphere", a: V(0, 0.26, -0.02), r: rng.range(0.135, 0.15), s: V(1, 0.85, 1.2), bone: "root" },
      { kind: "sphere", a: V(0, 0.4, 0.13), r: 0.1, s: V(1, 1, 1.05), bone: "head" },
    ];
    const legs = [];
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const side = sx > 0 ? "L" : "R";
        const tag = sz > 0 ? "F" : "B";
        limb(bones, parts, legs, {
          prefix: `leg${tag}`, side, parent: "root",
          from: V(sx * 0.09, 0.26, sz * 0.08),
          mid: V(sx * 0.17, 0.16, sz * 0.12),
          end: V(sx * 0.2, 0.04, sz * 0.15),
          r1: 0.032, r2: 0.028,
          tip: { kind: "sphere", a: V(sx * 0.2, 0.035, sz * 0.15), r: 0.04 },
          pole: V(sx, 0.4, sz * 0.25).normalize(), // knees splay up + out
        });
      }
    }
    return {
      bones, parts, legs, arms: [],
      mode: "walk",
      head: "head", spine: "root", root: "root",
      rootRest: 0.27, hipH: 0.26, stride: 0.3,
      eyes: { bone: "head", r: 0.032, offs: [V(0.05, 0.42, 0.21), V(-0.05, 0.42, 0.21)] },
      blend: 0.06,
    };
  },

  // ------------------------------------------------- no legs: floats
  bolt(rng) {
    const bones = [
      { name: "root", parent: null, pos: V(0, 0.42, 0) },
      { name: "head", parent: "root", pos: V(0, 0.53, 0) },
      { name: "antenna", parent: "head", pos: V(0, 0.62, 0) },
    ];
    const parts = [
      { kind: "sphere", a: V(0, 0.42, 0), r: rng.range(0.125, 0.14), s: V(1.08, 0.92, 1.08), bone: "root" },
      { kind: "sphere", a: V(0, 0.33, 0), r: 0.085, s: V(1.35, 0.55, 1.35), bone: "root" }, // hover skirt
      { kind: "sphere", a: V(0, 0.53, 0), r: 0.09, bone: "head" },
      { kind: "capsule", a: V(0, 0.6, 0), b: V(0, 0.69, 0), r: 0.014, bone: "antenna" },
      { kind: "sphere", a: V(0, 0.71, 0), r: 0.028, bone: "antenna" },
    ];
    const arms = [];
    limb(bones, parts, arms, {
      prefix: "arm", side: "L", parent: "root",
      from: V(0.13, 0.45, 0), mid: V(0.17, 0.35, 0), end: V(0.19, 0.26, 0),
      r1: 0.03, r2: 0.027,
      tip: { kind: "sphere", a: V(0.19, 0.25, 0), r: 0.042 },
      pole: V(0.5, -0.2, -1),
    });
    limb(bones, parts, arms, {
      prefix: "arm", side: "R", parent: "root",
      from: V(-0.13, 0.45, 0), mid: V(-0.17, 0.35, 0), end: V(-0.19, 0.26, 0),
      r1: 0.03, r2: 0.027,
      tip: { kind: "sphere", a: V(-0.19, 0.25, 0), r: 0.042 },
      pole: V(-0.5, -0.2, -1),
    });
    return {
      bones, parts, legs: [], arms,
      mode: "float",
      head: "head", spine: "head", root: "root",
      rootRest: 0.42, stride: 0.4,
      eyes: { bone: "head", r: 0.045, offs: [V(0, 0.53, 0.078)] }, // cyclops lens
      blend: 0.05,
    };
  },
};

// deterministic per-species geometry cache (one goo bake per species+variant)
const _cache = new Map();

export function speciesBuild(key, variant = 0) {
  const cacheKey = `${key}:${variant}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  // tiny deterministic rng so variants differ but stay stable
  let s = 1234 + variant * 977 + key.length * 131;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  rand.range = (a, b) => a + rand() * (b - a);

  const def = BUILDS[key](rand);
  const boneIndex = new Map(def.bones.map((b, i) => [b.name, i]));
  for (const p of def.parts) p.bone = boneIndex.get(p.bone);
  const geometry = buildGooGeometry(def.parts, {
    res: 40,
    blend: def.blend,
    boneCount: def.bones.length,
  });
  const built = { def, boneIndex, geometry };
  _cache.set(cacheKey, built);
  return built;
}

// small canvas circle texture reused for blob shadows
let _shadowTex = null;
function shadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}

/**
 * A living crew avatar: seamless goo body + skeleton + eyes + blob shadow.
 * Drive it via .pose then call animateAvatar(av, dt, t) each frame.
 */
export function makeCrewAvatar(speciesKey, colorHex, variant = 0) {
  const { def, boneIndex, geometry } = speciesBuild(speciesKey, variant);

  // fresh bone instances per avatar
  const bones = def.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    return bone;
  });
  def.bones.forEach((b, i) => {
    const parentRest = b.parent ? def.bones[boneIndex.get(b.parent)].pos : new THREE.Vector3();
    bones[i].position.copy(b.pos).sub(parentRest);
    if (b.parent) bones[boneIndex.get(b.parent)].add(bones[i]);
  });

  const mat = toonMaterial(colorHex);
  const mesh = new THREE.SkinnedMesh(geometry, mat);
  mesh.frustumCulled = false;
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  addOutline(mesh, 0.016);

  const group = new THREE.Group();
  group.add(mesh);

  // eyes: white ball + pupil, parented to the head bone
  const headBone = bones[boneIndex.get(def.eyes.bone)];
  const headRest = def.bones[boneIndex.get(def.eyes.bone)].pos;
  const eyeMeshes = [];
  const eyeGeo = new THREE.SphereGeometry(1, 10, 8);
  for (const off of def.eyes.offs) {
    const eye = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.scale.setScalar(def.eyes.r);
    eye.position.copy(off).sub(headRest);
    const pupil = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0x141821 }));
    pupil.scale.setScalar(0.5);
    pupil.position.z = 0.62;
    eye.add(pupil);
    headBone.add(eye);
    eyeMeshes.push(eye);
  }

  // blob shadow
  const shadow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.material.rotation = 0;
  shadow.scale.set(0.5, 0.5, 1);
  shadow.position.y = 0.02;
  // sprites always face camera; use a flat plane instead for a ground blob
  group.remove(shadow);
  const shadowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.55),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.02;
  shadowMesh.renderOrder = 1;
  group.add(shadowMesh);

  // resolve animation rigs
  const rigLimb = (l) => ({
    upper: bones[boneIndex.get(l.upper)],
    lower: bones[boneIndex.get(l.lower)],
    end: bones[boneIndex.get(l.endBone)],
    rest: l.rest.clone(),
    upperRest: def.bones[boneIndex.get(l.upper)].pos.clone(),
    l1: def.bones[boneIndex.get(l.lower)].pos.clone().sub(def.bones[boneIndex.get(l.upper)].pos).length(),
    l2: l.rest.clone().sub(def.bones[boneIndex.get(l.lower)].pos).length(),
    restDirUpper: def.bones[boneIndex.get(l.lower)].pos.clone().sub(def.bones[boneIndex.get(l.upper)].pos).normalize(),
    restDirLower: l.rest.clone().sub(def.bones[boneIndex.get(l.lower)].pos).normalize(),
    side: l.side,
    pole: l.pole.clone(),
    phase: 0,
  });

  const av = {
    group,
    mesh,
    species: speciesKey,
    color: colorHex,
    bones,
    bone: (n) => bones[boneIndex.get(n)],
    cfg: def,
    legs: def.legs.map(rigLimb),
    arms: def.arms.map(rigLimb),
    rootBone: bones[boneIndex.get(def.root)],
    spineBone: bones[boneIndex.get(def.spine)],
    headBone,
    eyeMeshes,
    shadowMesh,
    // animation state
    anim: {
      phase: Math.random() * Math.PI * 2,
      t: Math.random() * 10,
      wobble: new THREE.Vector3(),
      wobbleVel: new THREE.Vector3(),
      lastSpeed: 0,
      blink: 1 + Math.random() * 3,
      blinkT: 0,
      deadT: 0,
      hopAir: 0,
    },
    // pose is written by the game layer every frame
    pose: {
      speed: 0,
      heading: 0,
      mode: "idle", // idle|walk|work|repair|douse|dead
      workPoint: null, // char-space point to aim arms at
      selected: false,
    },
  };
  return av;
}
