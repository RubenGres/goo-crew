import * as THREE from "three";

// ============================================================================
// Procedural animation for goo avatars. No keyframes anywhere:
//   - walk gait with phase-offset legs (works for 2 or 4 legs) + analytic
//     two-bone IK so feet actually plant
//   - hop gait with squash & stretch for the legless
//   - hover bob + tilt for float-bots
//   - arms swing with the gait, or IK-reach toward work points
//   - springy "noodle" wobble on the spine/head from acceleration
// Everything is driven from a tiny pose struct the game writes each frame.
// ============================================================================

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _fx = new THREE.Vector3();
const _fz = new THREE.Vector3();
const _H = new THREE.Vector3();
const _T = new THREE.Vector3();
const _D = new THREE.Vector3();
const _Dn = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _K = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _off = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _gq = new THREE.Quaternion();

// quaternion whose local +Y maps onto `y`, twisted so local +X leans toward xHint
function frameQuat(y, xHint, out) {
  _fz.crossVectors(xHint, y);
  if (_fz.lengthSq() < 1e-8) _fz.set(0, 0, 1);
  _fz.normalize();
  _fx.crossVectors(y, _fz).normalize();
  _m.makeBasis(_fx, y, _fz);
  return out.setFromRotationMatrix(_m);
}

function defaultXHint(dir, out) {
  out.crossVectors(_up, dir);
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  return out.normalize();
}

// Analytic 2-bone IK + bone orientation, all in world space.
// limb: rig from character.js. target: world-space end position.
export function applyLimbIK(limb, targetWorld, poleWorld, groupQuat) {
  const upper = limb.upper;
  const lower = limb.lower;

  // lazily cache rest-frame inverses
  if (!limb._qru) {
    limb._qru = frameQuat(limb.restDirUpper, defaultXHint(limb.restDirUpper, _tmp), new THREE.Quaternion()).invert();
    limb._qrl = frameQuat(limb.restDirLower, defaultXHint(limb.restDirLower, _tmp), new THREE.Quaternion()).invert();
  }

  upper.getWorldPosition(_H);
  _D.subVectors(targetWorld, _H);
  let d = _D.length();
  const maxD = (limb.l1 + limb.l2) * 0.999;
  if (d < 1e-6) {
    _D.set(0, -1, 0);
    d = 1e-6;
  }
  if (d > maxD) {
    _D.multiplyScalar(maxD / d);
    d = maxD;
  }
  _T.copy(_H).add(_D);
  _Dn.copy(_D).normalize();

  _axis.crossVectors(_Dn, poleWorld);
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
  else _axis.normalize();

  const cosA = THREE.MathUtils.clamp((limb.l1 * limb.l1 + d * d - limb.l2 * limb.l2) / (2 * limb.l1 * d), -1, 1);
  const a1 = Math.acos(cosA);

  // upper bone direction: rotate the reach direction toward the pole side
  _tmp.copy(_Dn).applyAxisAngle(_axis, a1);
  _K.copy(_H).addScaledVector(_tmp, limb.l1);
  _proj.copy(_H).addScaledVector(_Dn, limb.l1 * cosA);
  _off.subVectors(_K, _proj);
  if (_off.dot(poleWorld) < 0) {
    _tmp.copy(_Dn).applyAxisAngle(_axis, -a1);
    _K.copy(_H).addScaledVector(_tmp, limb.l1);
  }

  // orient upper
  const desiredUpper = frameQuat(_tmp, _axis, _q1).multiply(limb._qru);
  upper.parent.getWorldQuaternion(_q2);
  upper.quaternion.copy(_q2.invert()).multiply(desiredUpper);

  // orient lower
  _tmp2.subVectors(_T, _K).normalize();
  const desiredLower = frameQuat(_tmp2, _axis, _q2).multiply(limb._qrl);
  lower.quaternion.copy(_q3.copy(desiredUpper).invert()).multiply(desiredLower);

  // keep the end bone (foot/hand blob) level with the body's yaw
  limb.end.quaternion.copy(_q1.copy(desiredLower).invert()).multiply(groupQuat);
}

export function animateAvatar(av, dt, time) {
  const a = av.anim;
  const pose = av.pose;
  const cfg = av.cfg;
  a.t += dt;

  // ---------- death flop ----------
  if (pose.mode === "dead") {
    a.deadT = Math.min(1.2, a.deadT + dt);
    const k = Math.min(1, a.deadT * 2.2);
    av.mesh.rotation.x = (-Math.PI / 2) * k * 0.92;
    av.mesh.position.y = -cfg.rootRest * 0.35 * k + cfg.rootRest * 0.28;
    for (const eye of av.eyeMeshes) eye.scale.y = av.cfg.eyes.r * 0.12;
    const fade = a.deadT > 0.7 ? 1 - (a.deadT - 0.7) / 0.5 : 1;
    av.mesh.material.transparent = true;
    av.mesh.material.opacity = Math.max(0, fade);
    av.mesh.traverse((o) => {
      if (o.material && o !== av.mesh) {
        o.material.transparent = true;
        o.material.opacity = Math.max(0, fade) * (o.material.userData?.baseOpacity ?? 1);
      }
    });
    av.shadowMesh.material.opacity = Math.max(0, fade) * 0.8;
    return;
  }
  av.mesh.rotation.x = 0;
  av.mesh.position.y = 0;
  a.deadT = 0;

  const speed = pose.speed;
  const moving = speed > 0.06;
  const root = av.rootBone;

  // acceleration → noodle wobble: a critically-damped-ish spring in char space
  _tmp.set(Math.sin(pose.heading), 0, Math.cos(pose.heading)).multiplyScalar(speed);
  if (!a.lastVel) a.lastVel = new THREE.Vector3();
  _tmp2.subVectors(_tmp, a.lastVel).divideScalar(Math.max(dt, 1 / 240));
  a.lastVel.copy(_tmp);
  _tmp2.applyAxisAngle(_up, -pose.heading); // to char space (undo heading)
  _tmp2.clampLength(0, 25);
  a.wobbleVel.addScaledVector(a.wobble, -42 * dt); // spring
  a.wobbleVel.multiplyScalar(Math.max(0, 1 - 9 * dt)); // damping
  a.wobbleVel.addScaledVector(_tmp2, -0.06 * dt); // lean away from acceleration
  a.wobble.addScaledVector(a.wobbleVel, dt);
  a.wobble.clampLength(0, 0.22);

  // ---------- gait phase ----------
  const stepHz = Math.max(1.5, speed / cfg.stride);
  if (moving) a.phase += dt * Math.PI * 2 * stepHz;
  else a.phase += dt * Math.PI * 2 * 0.4; // slow idle sway keeps them alive

  const walkAmt = THREE.MathUtils.clamp(speed / 1.2, 0, 1);

  // ---------- root / body ----------
  let rootY = cfg.rootRest;
  let squash = 1;
  if (cfg.mode === "walk") {
    rootY += Math.abs(Math.sin(a.phase)) * 0.028 * walkAmt + Math.sin(a.t * 2.1) * 0.006;
    root.rotation.set(
      0.14 * walkAmt + a.wobble.z * 0.9,
      0,
      Math.sin(a.phase) * 0.055 * walkAmt - a.wobble.x * 0.9,
    );
  } else if (cfg.mode === "hop") {
    const hop = moving ? Math.abs(Math.sin(a.phase * 0.5)) : 0;
    const breathe = Math.sin(a.t * 2.4) * 0.03;
    rootY += hop * 0.22 * walkAmt;
    a.hopAir = hop;
    squash = moving ? 0.78 + 0.3 * Math.min(1, hop * 2.2) : 1 + breathe;
    squash = THREE.MathUtils.clamp(squash, 0.7, 1.12);
    root.rotation.set(0.12 * walkAmt * Math.sin(a.phase * 0.5) + a.wobble.z, 0, -a.wobble.x);
  } else if (cfg.mode === "float") {
    rootY += Math.sin(a.t * 1.9 + a.phase * 0.05) * 0.045 + speed * 0.015;
    root.rotation.set(
      THREE.MathUtils.clamp(speed * 0.22, 0, 0.35) + a.wobble.z * 1.4,
      0,
      -a.wobble.x * 1.4,
    );
  }
  root.position.y = rootY;
  root.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

  // spine + head wobble / look
  if (av.spineBone !== root) {
    av.spineBone.rotation.set(a.wobble.z * 1.6, 0, -a.wobble.x * 1.6);
  }
  if (av.headBone !== av.spineBone) {
    const workLook = pose.workPoint && pose.mode !== "walk";
    av.headBone.rotation.set(
      (workLook ? 0.35 : 0.0) + a.wobble.z * 1.6 + Math.sin(a.t * 1.3) * 0.04,
      Math.sin(a.t * 0.9) * 0.06,
      -a.wobble.x * 1.6,
    );
  }

  // blink
  a.blink -= dt;
  if (a.blink <= 0) {
    a.blink = 1.6 + Math.random() * 3.4;
    a.blinkT = 0.13;
  }
  a.blinkT = Math.max(0, a.blinkT - dt);
  const eyeScaleY = a.blinkT > 0 ? 0.12 : 1;
  for (const eye of av.eyeMeshes) {
    eye.scale.set(cfg.eyes.r, cfg.eyes.r * eyeScaleY, cfg.eyes.r);
  }

  // commit body transforms so limb IK reads fresh world matrices
  av.group.updateMatrixWorld(true);
  av.group.getWorldQuaternion(_gq);

  // ---------- legs ----------
  const legs = av.legs;
  if (legs.length) {
    const nLegs = legs.length;
    const strideAmp = moving ? Math.min(0.16, speed / (Math.PI * 2 * stepHz) * 2.6) : 0;
    for (let i = 0; i < nLegs; i++) {
      const leg = legs[i];
      // 2 legs: alternate. 4 legs: diagonal pairs.
      const phaseOff = nLegs === 2 ? i * Math.PI : (i === 0 || i === 3 ? 0 : Math.PI);
      const p = a.phase + phaseOff;
      if (!leg._target) leg._target = leg.rest.clone();
      _tmp.copy(leg.rest);
      _tmp.z += Math.cos(p) * strideAmp;
      _tmp.y = leg.rest.y + Math.max(0, Math.sin(p)) * 0.085 * walkAmt;
      if (!moving) {
        _tmp.copy(leg.rest);
        _tmp.y += Math.max(0, Math.sin(a.t * 2.1 + i * 1.7)) * 0.004; // micro weight shifts
      }
      leg._target.lerp(_tmp, Math.min(1, dt * 26));
      _T.copy(leg._target);
      av.group.localToWorld(_T);
      _pole.copy(leg.pole).applyQuaternion(_gq).normalize();
      applyLimbIK(leg, _T, _pole, _gq);
    }
  }

  // ---------- arms ----------
  const arms = av.arms;
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    if (!arm._target) arm._target = arm.rest.clone();
    _tmp.copy(arm.rest);

    if (pose.mode === "repair" || pose.mode === "douse" || pose.mode === "work") {
      // reach toward the console / breach / fire
      const reach = pose.workPoint || _tmp2.set(arm.side * 0.1, cfg.rootRest * 1.2, 0.3);
      _tmp.set(arm.side * 0.09, reach.y ?? cfg.rootRest * 1.25, 0.26);
      if (pose.mode === "repair") {
        // alternating hammering
        const h = Math.sin(a.t * 13 + i * Math.PI);
        _tmp.y += h * 0.06;
        _tmp.z += Math.abs(h) * 0.05;
      } else if (pose.mode === "douse") {
        _tmp.z += 0.08 + Math.sin(a.t * 6 + i * 2) * 0.02;
        _tmp.y += Math.sin(a.t * 6 + i * 2) * 0.03;
      } else {
        _tmp.z += Math.sin(a.t * 2.2 + i * 2.4) * 0.02; // gentle console taps
        _tmp.y += Math.sin(a.t * 3.1 + i * 1.2) * 0.015;
      }
    } else if (moving) {
      // swing opposite the legs (or flail while hopping)
      const swing = cfg.mode === "hop"
        ? Math.sin(a.phase * 0.5 + Math.PI / 2) * 0.6
        : Math.sin(a.phase + (arm.side > 0 ? Math.PI : 0));
      _tmp.z += swing * 0.11 * walkAmt;
      _tmp.x += arm.side * 0.02 * walkAmt;
      _tmp.y += Math.abs(swing) * 0.02;
    } else {
      _tmp.y += Math.sin(a.t * 2.4 + i * 2.2) * 0.008; // breathe
    }

    arm._target.lerp(_tmp, Math.min(1, dt * 14));
    _T.copy(arm._target);
    av.group.localToWorld(_T);
    _pole.copy(arm.pole).applyQuaternion(_gq).normalize();
    applyLimbIK(arm, _T, _pole, _gq);
  }
}
