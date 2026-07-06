import * as THREE from "three";

// Sprite particle pool: flames, smoke, sparks, air puffs, explosions, rings.
// One shared geometry+texture set, additive or normal blending per particle.

function radialTex(inner = "rgba(255,255,255,0.95)", outer = "rgba(255,255,255,0)") {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function ringTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

const MAX = 320;

export class FxPool {
  constructor(scene) {
    this.scene = scene;
    this.texSoft = radialTex();
    this.texRing = ringTex();
    this.pool = [];
    this.live = [];
    for (let i = 0; i < MAX; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.texSoft,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.pool.push(s);
    }
  }

  spawn(opts) {
    const s = this.pool.pop();
    if (!s) return null;
    const p = {
      s,
      t: 0,
      life: opts.life ?? 0.6,
      vel: opts.vel ? opts.vel.clone() : new THREE.Vector3(),
      grav: opts.grav ?? 0,
      drag: opts.drag ?? 0,
      scale0: opts.scale ?? 0.3,
      scale1: opts.scaleEnd ?? (opts.scale ?? 0.3),
      opacity0: opts.opacity ?? 1,
      opacity1: opts.opacityEnd ?? 0,
      colorFrom: new THREE.Color(opts.color ?? 0xffffff),
      colorTo: new THREE.Color(opts.colorEnd ?? opts.color ?? 0xffffff),
      flicker: opts.flicker ?? 0,
    };
    s.position.copy(opts.pos);
    s.material.map = opts.ring ? this.texRing : this.texSoft;
    s.material.blending = opts.soft ? THREE.NormalBlending : THREE.AdditiveBlending;
    s.material.rotation = Math.random() * Math.PI * 2;
    s.visible = true;
    this.live.push(p);
    return p;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        p.s.visible = false;
        this.pool.push(p.s);
        this.live.splice(i, 1);
        continue;
      }
      p.vel.y += p.grav * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      const sc = p.scale0 + (p.scale1 - p.scale0) * k;
      p.s.scale.set(sc, sc, 1);
      let op = p.opacity0 + (p.opacity1 - p.opacity0) * k;
      if (p.flicker) op *= 1 - p.flicker * 0.5 + Math.random() * p.flicker;
      p.s.material.opacity = Math.max(0, Math.min(1, op));
      p.s.material.color.copy(p.colorFrom).lerp(p.colorTo, k);
    }
  }

  // ------------------------------------------------ composite effects

  flame(pos, intensity = 1) {
    this.spawn({
      pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.05, (Math.random() - 0.5) * 0.5)),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.15),
      life: 0.35 + Math.random() * 0.25,
      scale: 0.28 * intensity + Math.random() * 0.12,
      scaleEnd: 0.05,
      color: 0xffc744,
      colorEnd: 0xff4d1a,
      opacity: 0.9,
      flicker: 0.5,
    });
    if (Math.random() < 0.3) {
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.35, (Math.random() - 0.5) * 0.4)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.7, (Math.random() - 0.5) * 0.2),
        life: 1.1,
        scale: 0.25,
        scaleEnd: 0.6,
        color: 0x222230,
        colorEnd: 0x111118,
        opacity: 0.5,
        soft: true,
      });
    }
  }

  sparks(pos, n = 10, color = 0xffd27a) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2.2;
      this.spawn({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), up, Math.sin(a) * (1 + Math.random() * 2)),
        grav: -6,
        life: 0.35 + Math.random() * 0.35,
        scale: 0.1,
        scaleEnd: 0.02,
        color,
        opacity: 1,
      });
    }
  }

  explosion(pos, scale = 1) {
    this.spawn({ pos, life: 0.45, scale: 0.6 * scale, scaleEnd: 2.6 * scale, color: 0xfff2c4, colorEnd: 0xff5a1f, opacity: 1 });
    this.spawn({ pos, life: 0.7, scale: 0.3 * scale, scaleEnd: 3.4 * scale, color: 0xff8a3c, colorEnd: 0x551a0c, opacity: 0.8 });
    this.spawn({ pos, ring: true, life: 0.5, scale: 0.5 * scale, scaleEnd: 4 * scale, color: 0xffd7a1, opacity: 0.9 });
    this.sparks(pos, Math.round(14 * scale));
    for (let i = 0; i < 6 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({
        pos: pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3)),
        vel: new THREE.Vector3(Math.cos(a) * 0.8, 0.9 + Math.random(), Math.sin(a) * 0.8),
        life: 1.4,
        scale: 0.4,
        scaleEnd: 1.1 * scale,
        color: 0x2a2a33,
        colorEnd: 0x101016,
        opacity: 0.6,
        soft: true,
      });
    }
  }

  shieldHit(pos, radius = 1) {
    this.spawn({ pos, ring: true, life: 0.4, scale: radius, scaleEnd: radius * 2.1, color: 0x7defff, opacity: 0.95 });
    this.spawn({ pos, life: 0.3, scale: radius * 0.7, scaleEnd: radius * 1.4, color: 0x9df2ff, colorEnd: 0x2b7ce8, opacity: 0.55 });
  }

  airPuff(pos) {
    this.spawn({
      pos,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.4 + Math.random(), (Math.random() - 0.5) * 0.4),
      life: 0.7,
      scale: 0.14,
      scaleEnd: 0.5,
      color: 0xcfe8ff,
      opacity: 0.7,
      soft: true,
    });
  }

  healSpark(pos) {
    this.spawn({
      pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3)),
      vel: new THREE.Vector3(0, 0.7, 0),
      life: 0.8,
      scale: 0.12,
      scaleEnd: 0.03,
      color: 0x8dff9a,
      opacity: 0.95,
    });
  }

  douseSpray(pos, dir) {
    this.spawn({
      pos,
      vel: dir.clone().multiplyScalar(1.6).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5)),
      life: 0.45,
      scale: 0.12,
      scaleEnd: 0.3,
      color: 0xbfe6ff,
      opacity: 0.8,
      soft: true,
    });
  }
}
