import * as THREE from "three";

// ============================================================================
// GOO — the seamless-body tech.
//
// Characters are authored as a handful of primitive shapes (spheres, capsules)
// like classic "primitives stuck together" prototyping — but instead of
// rendering the primitives, we fuse them into ONE surface:
//
//   1. every primitive is a signed distance function (SDF)
//   2. primitives blend with a polynomial smooth-min, so joints melt together
//   3. the combined field is polygonized ONCE at generation time with
//      marching tetrahedra (tiny code, no lookup tables)
//   4. vertices are welded, normals come from the SDF gradient (perfectly
//      smooth across blends — no visible seams, ever)
//   5. skin weights are derived from each bone's own sub-field, so the mesh
//      deforms exactly where the primitives blend
//
// Runtime cost is a single static SkinnedMesh per character — mobile friendly.
// ============================================================================

const _v = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

export function sdSphere(p, c, r) {
  return p.distanceTo(c) - r;
}

// ellipsoid-ish sphere: distances divided per-axis scale (art approximation)
export function sdBlob(p, c, r, s) {
  const dx = (p.x - c.x) / (r * s.x);
  const dy = (p.y - c.y) / (r * s.y);
  const dz = (p.z - c.z) / (r * s.z);
  return (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * r * Math.min(s.x, s.y, s.z);
}

export function sdCapsule(p, a, b, r) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / Math.max(1e-9, _ab.lengthSq())));
  _v.copy(a).addScaledVector(_ab, t);
  return p.distanceTo(_v) - r;
}

// polynomial smooth min — the "melt" that makes separate shapes one body
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function partDist(part, p) {
  if (part.kind === "capsule") return sdCapsule(p, part.a, part.b, part.r);
  if (part.s) return sdBlob(p, part.a, part.r, part.s);
  return sdSphere(p, part.a, part.r);
}

// Marching tetrahedra: each grid cube splits into 6 tets sharing the 0-6
// diagonal. A tet crossing the isosurface emits 1 or 2 triangles. No tables.
const CUBE_OFFS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];

/**
 * Build a seamless skinned geometry from goo parts.
 * @param parts   [{kind:'sphere'|'capsule', a:V3, b?:V3, r, s?:V3, bone:int}]
 * @param opts    { res: cells on the longest axis, blend: smooth-min k,
 *                  boneCount, boneFalloff }
 * @returns THREE.BufferGeometry with position/normal/skinIndex/skinWeight
 */
export function buildGooGeometry(parts, opts = {}) {
  const res = opts.res ?? 34;
  const blend = opts.blend ?? 0.09;
  const boneFalloff = opts.boneFalloff ?? blend * 1.6;
  const boneCount = opts.boneCount ?? 1 + Math.max(...parts.map((p) => p.bone ?? 0));

  // bounds
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const part of parts) {
    const pad = part.r * (part.s ? Math.max(part.s.x, part.s.y, part.s.z) : 1) + blend * 1.5;
    min.min(_v.copy(part.a).subScalar(pad));
    max.max(_v.copy(part.a).addScalar(pad));
    if (part.b) {
      min.min(_v.copy(part.b).subScalar(pad));
      max.max(_v.copy(part.b).addScalar(pad));
    }
  }

  const size = new THREE.Vector3().subVectors(max, min);
  const longest = Math.max(size.x, size.y, size.z);
  const cell = longest / res;
  const nx = Math.max(2, Math.ceil(size.x / cell));
  const ny = Math.max(2, Math.ceil(size.y / cell));
  const nz = Math.max(2, Math.ceil(size.z / cell));

  const field = (p) => {
    let d = Infinity;
    for (const part of parts) d = smin(d, partDist(part, p), blend);
    return d;
  };

  // sample grid
  const gx = nx + 1, gy = ny + 1, gz = nz + 1;
  const samples = new Float32Array(gx * gy * gz);
  const sp = new THREE.Vector3();
  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        sp.set(min.x + ix * cell, min.y + iy * cell, min.z + iz * cell);
        samples[ix + gx * (iy + gy * iz)] = field(sp);
      }
    }
  }
  const sampleAt = (ix, iy, iz) => samples[ix + gx * (iy + gy * iz)];

  // polygonize
  const positions = [];
  const indexMap = new Map(); // welded vertex key -> index
  const indices = [];
  const cornerPos = new Array(8).fill().map(() => new THREE.Vector3());
  const cornerVal = new Float32Array(8);
  const edgeVert = (pa, va, pb, vb) => {
    const t = va / (va - vb);
    const x = pa.x + (pb.x - pa.x) * t;
    const y = pa.y + (pb.y - pa.y) * t;
    const z = pa.z + (pb.z - pa.z) * t;
    const key = `${Math.round(x * 1024)},${Math.round(y * 1024)},${Math.round(z * 1024)}`;
    let idx = indexMap.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, y, z);
      indexMap.set(key, idx);
    }
    return idx;
  };

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        let inside = 0, outside = 0;
        for (let c = 0; c < 8; c++) {
          const o = CUBE_OFFS[c];
          const v = sampleAt(ix + o[0], iy + o[1], iz + o[2]);
          cornerVal[c] = v;
          if (v < 0) inside++; else outside++;
          cornerPos[c].set(min.x + (ix + o[0]) * cell, min.y + (iy + o[1]) * cell, min.z + (iz + o[2]) * cell);
        }
        if (inside === 0 || outside === 0) continue;

        for (const tet of TETS) {
          const ins = [];
          const outs = [];
          for (const c of tet) (cornerVal[c] < 0 ? ins : outs).push(c);
          if (ins.length === 0 || ins.length === 4) continue;

          if (ins.length === 1 || ins.length === 3) {
            const solo = ins.length === 1 ? ins[0] : outs[0];
            const others = ins.length === 1 ? outs : ins;
            const a = edgeVert(cornerPos[solo], cornerVal[solo], cornerPos[others[0]], cornerVal[others[0]]);
            const b = edgeVert(cornerPos[solo], cornerVal[solo], cornerPos[others[1]], cornerVal[others[1]]);
            const c = edgeVert(cornerPos[solo], cornerVal[solo], cornerPos[others[2]], cornerVal[others[2]]);
            indices.push(a, b, c);
          } else {
            // 2 in / 2 out -> quad
            const [i0, i1] = ins;
            const [o0, o1] = outs;
            const a = edgeVert(cornerPos[i0], cornerVal[i0], cornerPos[o0], cornerVal[o0]);
            const b = edgeVert(cornerPos[i0], cornerVal[i0], cornerPos[o1], cornerVal[o1]);
            const c = edgeVert(cornerPos[i1], cornerVal[i1], cornerPos[o1], cornerVal[o1]);
            const d = edgeVert(cornerPos[i1], cornerVal[i1], cornerPos[o0], cornerVal[o0]);
            indices.push(a, b, c, a, c, d);
          }
        }
      }
    }
  }

  // normals from SDF gradient — smooth everywhere, hides all seams
  const nVerts = positions.length / 3;
  const normals = new Float32Array(nVerts * 3);
  const gp = new THREE.Vector3();
  const sq = new THREE.Vector3(); // sample point — must not alias goo.js temps
  const eps = cell * 0.5;
  for (let i = 0; i < nVerts; i++) {
    gp.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const dx = field(sq.set(gp.x + eps, gp.y, gp.z)) - field(sq.set(gp.x - eps, gp.y, gp.z));
    const dy = field(sq.set(gp.x, gp.y + eps, gp.z)) - field(sq.set(gp.x, gp.y - eps, gp.z));
    const dz = field(sq.set(gp.x, gp.y, gp.z + eps)) - field(sq.set(gp.x, gp.y, gp.z - eps));
    const l = Math.max(1e-9, Math.hypot(dx, dy, dz));
    normals[i * 3] = dx / l;
    normals[i * 3 + 1] = dy / l;
    normals[i * 3 + 2] = dz / l;
  }

  // fix winding: triangle normal should agree with the field gradient
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f], b = indices[f + 1], c = indices[f + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nxg = uy * vz - uz * vy;
    const nyg = uz * vx - ux * vz;
    const nzg = ux * vy - uy * vx;
    const g = nxg * normals[a * 3] + nyg * normals[a * 3 + 1] + nzg * normals[a * 3 + 2];
    if (g < 0) {
      indices[f + 1] = c;
      indices[f + 2] = b;
    }
  }

  // skin weights: per bone, distance to that bone's own sub-field; nearby
  // bones share the vertex smoothly (matches the visual smooth-min blending)
  const skinIndex = new Uint16Array(nVerts * 4);
  const skinWeight = new Float32Array(nVerts * 4);
  const boneDist = new Float32Array(boneCount);
  for (let i = 0; i < nVerts; i++) {
    gp.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    boneDist.fill(Infinity);
    for (const part of parts) {
      const b = part.bone ?? 0;
      const d = partDist(part, gp);
      if (d < boneDist[b]) boneDist[b] = d;
    }
    // influence: closest bone dominates; falloff over boneFalloff
    let best = 0;
    for (let b = 1; b < boneCount; b++) if (boneDist[b] < boneDist[best]) best = b;
    const d0 = boneDist[best];
    const w = [];
    for (let b = 0; b < boneCount; b++) {
      const excess = boneDist[b] - d0;
      if (excess < boneFalloff) {
        const t = 1 - excess / boneFalloff;
        w.push([b, t * t]);
      }
    }
    w.sort((x, y) => y[1] - x[1]);
    let sum = 0;
    for (let k = 0; k < Math.min(4, w.length); k++) sum += w[k][1];
    for (let k = 0; k < 4; k++) {
      if (k < w.length && sum > 0) {
        skinIndex[i * 4 + k] = w[k][0];
        skinWeight[i * 4 + k] = w[k][1] / sum;
      } else {
        skinIndex[i * 4 + k] = best;
        skinWeight[i * 4 + k] = 0;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(indices);
  return geo;
}
