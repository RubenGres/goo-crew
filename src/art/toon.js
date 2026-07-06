import * as THREE from "three";

// Toon look: stepped gradient map + inverted-hull outlines. The gradient map
// is a tiny DataTexture so shading collapses into 3 flat bands — combined with
// SDF gradient normals this is what sells the "one seamless body" illusion.

let _gradientMap = null;
export function gradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([90, 160, 255, 255]); // 4 bands
  _gradientMap = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  _gradientMap.needsUpdate = true;
  _gradientMap.minFilter = THREE.NearestFilter;
  _gradientMap.magFilter = THREE.NearestFilter;
  return _gradientMap;
}

export function toonMaterial(color, opts = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    ...opts,
  });
  return mat;
}

// Outline material: pushes vertices along their normal BEFORE skinning is
// applied, so the same skeleton drives the shell. Works for static meshes too.
export function outlineMaterial(thickness = 0.02, color = 0x10121e) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader =
      "uniform float uOutline;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n transformed += normalize(normal) * uOutline;",
      );
  };
  return mat;
}

// Wrap a mesh (skinned or not) with its inverted-hull outline shell.
export function addOutline(mesh, thickness = 0.02, color) {
  let shell;
  if (mesh.isSkinnedMesh) {
    shell = new THREE.SkinnedMesh(mesh.geometry, outlineMaterial(thickness, color));
    shell.bind(mesh.skeleton, mesh.bindMatrix);
  } else {
    shell = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  }
  shell.frustumCulled = false;
  mesh.add(shell);
  return shell;
}
