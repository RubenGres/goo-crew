// Headless sanity checks for the goo character tech: mesh generation produces
// a real welded surface with normalized skin weights, and the analytic 2-bone
// IK actually plants end effectors on their targets.
import assert from "node:assert";
import * as THREE from "three";
import { buildGooGeometry } from "../src/art/goo.js";
import { speciesBuild } from "../src/art/character.js";
import { applyLimbIK } from "../src/art/animate.js";

// ---------------------------------------------------------------- goo mesher
{
  const parts = [
    { kind: "sphere", a: new THREE.Vector3(0, 0, 0), r: 0.3, bone: 0 },
    { kind: "capsule", a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(0, 0.5, 0), r: 0.15, bone: 1 },
  ];
  const geo = buildGooGeometry(parts, { res: 24, blend: 0.1, boneCount: 2 });
  const nVerts = geo.attributes.position.count;
  assert.ok(nVerts > 200, `goo mesh should have real vertex count, got ${nVerts}`);
  assert.ok(geo.index.count >= nVerts, "welded mesh should share vertices between triangles");

  // skin weights normalized
  const w = geo.attributes.skinWeight;
  for (let i = 0; i < nVerts; i++) {
    const sum = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
    assert.ok(Math.abs(sum - 1) < 1e-4, `skin weights must sum to 1, got ${sum} at vert ${i}`);
  }

  // normals unit length and, on the far sphere surface, pointing outward
  const n = geo.attributes.normal;
  const p = geo.attributes.position;
  let outward = 0;
  for (let i = 0; i < nVerts; i++) {
    const len = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    assert.ok(Math.abs(len - 1) < 1e-3, "normals must be unit length");
    if (p.getY(i) < -0.1) {
      // bottom hemisphere of the base sphere: normal should point away from origin
      const dot = p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i);
      if (dot > 0) outward++;
      else outward--;
    }
  }
  assert.ok(outward > 0, "surface normals should point outward");
  console.log(`goo mesher ok (${nVerts} verts, ${geo.index.count / 3} tris)`);
}

// ------------------------------------------------------------- species bakes
for (const key of ["noodler", "gloop", "skitter", "bolt"]) {
  const { def, geometry } = speciesBuild(key);
  assert.ok(geometry.attributes.position.count > 500, `${key} should produce a body`);
  assert.ok(def.bones.length >= 2, `${key} needs bones`);
  const tris = geometry.index.count / 3;
  console.log(`${key}: ${geometry.attributes.position.count} verts, ${tris} tris, ${def.bones.length} bones, ${def.legs.length} legs, ${def.arms.length} arms`);
  assert.ok(tris < 30000, `${key} should stay mobile-friendly (${tris} tris)`);
}

// --------------------------------------------------------------------- IK
{
  // build a real bone chain: shoulder at (0,1,0), straight down, l1=l2=0.4
  const group = new THREE.Group();
  const rootObj = new THREE.Object3D();
  group.add(rootObj);
  const upper = new THREE.Bone();
  const lower = new THREE.Bone();
  const end = new THREE.Bone();
  upper.position.set(0, 1, 0);
  lower.position.set(0, -0.4, 0);
  end.position.set(0, -0.4, 0);
  rootObj.add(upper);
  upper.add(lower);
  lower.add(end);

  const limb = {
    upper,
    lower,
    end,
    l1: 0.4,
    l2: 0.4,
    restDirUpper: new THREE.Vector3(0, -1, 0),
    restDirLower: new THREE.Vector3(0, -1, 0),
    rest: new THREE.Vector3(0, 0.2, 0),
    side: 1,
    pole: new THREE.Vector3(0, 0, 1),
  };

  const groupQuat = new THREE.Quaternion();
  const target = new THREE.Vector3();
  const endWorld = new THREE.Vector3();
  const kneeWorld = new THREE.Vector3();

  let worst = 0;
  const cases = [
    [0.15, 0.45, 0.2], [0, 0.3, 0.3], [-0.2, 0.5, 0.1], [0.1, 0.9, 0.35],
    [0.3, 0.4, -0.15], [0, 0.25, 0.05], [-0.3, 0.7, 0.3],
  ];
  for (const [x, y, z] of cases) {
    target.set(x, y, z);
    group.updateMatrixWorld(true);
    applyLimbIK(limb, target, new THREE.Vector3(0, 0, 1), groupQuat);
    group.updateMatrixWorld(true);
    end.getWorldPosition(endWorld);
    const err = endWorld.distanceTo(target);
    worst = Math.max(worst, err);
    assert.ok(err < 2e-3, `IK end effector should hit target, err=${err} for [${x},${y},${z}]`);
    // knee should bend toward the pole (+z) when the chain is bent
    lower.getWorldPosition(kneeWorld);
    const mid = new THREE.Vector3(0, 1, 0).add(target).multiplyScalar(0.5);
    if (new THREE.Vector3(0, 1, 0).distanceTo(target) < 0.78) {
      assert.ok(kneeWorld.z >= mid.z - 1e-3, `knee should bend toward pole, kneeZ=${kneeWorld.z} midZ=${mid.z}`);
    }
  }
  console.log(`ik ok (worst end-effector error ${worst.toExponential(2)})`);

  // unreachable target: should clamp gracefully, not NaN
  target.set(0, -2, 0);
  group.updateMatrixWorld(true);
  applyLimbIK(limb, target, new THREE.Vector3(0, 0, 1), groupQuat);
  group.updateMatrixWorld(true);
  end.getWorldPosition(endWorld);
  assert.ok(Number.isFinite(endWorld.x + endWorld.y + endWorld.z), "IK must stay finite when overreaching");
  console.log("ik overreach clamp ok");
}

console.log("char.test: all good");
