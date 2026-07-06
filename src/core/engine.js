import * as THREE from "three";

// Renderer + scene + camera + space backdrop + screen shake.
// Deliberately no post-processing chain: outlines are inverted hulls, glow is
// additive sprites — keeps the whole thing happy on mobile GPUs.

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // punchy flat toon colors

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c14);
    this.scene.fog = new THREE.Fog(0x0a0c14, 55, 110);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camBase = new THREE.Vector3(0.6, 15.5, 10.5);
    this.camLook = new THREE.Vector3(0.6, 0, 0.6);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camLook);

    // lighting: hemi for soft fill, key directional for toon banding
    const hemi = new THREE.HemisphereLight(0xbdd4ff, 0x2a2438, 0.9);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-6, 14, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb0ff, 0.5);
    rim.position.set(8, 6, -9);
    this.scene.add(rim);

    this._buildBackdrop();

    this.shake = 0;
    this.driftT = Math.random() * 100;
    this.zoom = 1;

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  _buildBackdrop() {
    // layered starfield points (parallax via different drift speeds)
    this.starLayers = [];
    for (let layer = 0; layer < 3; layer++) {
      const n = 260;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 160;
        pos[i * 3 + 1] = -12 - layer * 10 - Math.random() * 10;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({
        color: [0xffffff, 0x9fc3ff, 0x6f86c8][layer],
        size: [0.22, 0.16, 0.1][layer],
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9 - layer * 0.22,
        depthWrite: false,
      });
      const pts = new THREE.Points(g, m);
      pts.userData.speed = [1.6, 0.9, 0.45][layer];
      this.scene.add(pts);
      this.starLayers.push(pts);
    }

    // soft nebula blobs: big additive sprites far below the ships
    const nebCanvas = document.createElement("canvas");
    nebCanvas.width = nebCanvas.height = 128;
    const ctx = nebCanvas.getContext("2d");
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.85)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const nebTex = new THREE.CanvasTexture(nebCanvas);
    this.nebTex = nebTex;
    const nebCols = [0x2a2f68, 0x4a2358, 0x16404e, 0x35204d];
    this.nebulae = [];
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.SpriteMaterial({
        map: nebTex,
        color: nebCols[i % nebCols.length],
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      const scale = 26 + Math.random() * 40;
      s.scale.set(scale, scale * 0.7, 1);
      s.position.set((Math.random() - 0.5) * 110, -34, (Math.random() - 0.5) * 70);
      this.scene.add(s);
      this.nebulae.push(s);
    }
  }

  // Randomize the backdrop feel per beacon (nebula tint drift)
  restyleBackdrop(rand) {
    for (const s of this.nebulae) {
      s.position.x = (rand() - 0.5) * 110;
      s.position.z = (rand() - 0.5) * 70;
      s.material.color.setHSL(rand(), 0.5, 0.22);
    }
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // pull the camera back on narrow screens so both ships stay framed
    const fit = Math.max(1, 1.55 - (w / h) * 0.42);
    this.fitDist = fit;
    this.camera.updateProjectionMatrix();
  }

  update(dt, starSpeed = 1) {
    this.driftT += dt;
    // slow parallax star drift, as if cruising
    for (const pts of this.starLayers) {
      pts.position.x -= dt * 0.35 * pts.userData.speed * starSpeed;
      if (pts.position.x < -40) pts.position.x += 80;
    }

    // camera: gentle breathing drift + decaying shake
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const s = this.shake * this.shake * 0.5;
    const t = this.driftT;
    const fit = this.fitDist || 1;
    this.camera.position.set(
      this.camBase.x + Math.sin(t * 0.21) * 0.25 + (Math.random() - 0.5) * s,
      (this.camBase.y + Math.sin(t * 0.13) * 0.2) * fit * this.zoom + (Math.random() - 0.5) * s,
      (this.camBase.z + Math.cos(t * 0.17) * 0.2) * fit * this.zoom + (Math.random() - 0.5) * s * 0.6,
    );
    this.camera.lookAt(this.camLook);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
