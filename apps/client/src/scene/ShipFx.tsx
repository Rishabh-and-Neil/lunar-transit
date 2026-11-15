// Per-ship visual effects: shield bubble, stun arcs, hazard warnings and
// one-shot bursts triggered through fxBus (hazard hits, abilities, repair, explosion).
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  type Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { HazardType } from "@sm/shared";
import { renderBridge } from "../state/renderBridge";
import { HAZARD_COLORS } from "./constants";
import { fxBus, type FxKind } from "./fxBus";
import { ParticleSystem } from "./particles";
import { getShipGeometries, getShipMaterials, makeGlowSprite } from "./shipParts";
import type { ShipControl } from "./Spacecraft";
import { getWarningTexture } from "./textures";

const shieldVert = /* glsl */ `
varying vec3 vNV; varying vec3 vPV; varying vec3 vObj;
void main(){
  vObj = position;
  vNV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const shieldFrag = /* glsl */ `
uniform vec3 uColor; uniform float uStrength; uniform float uTime; uniform float uHit;
varying vec3 vNV; varying vec3 vPV; varying vec3 vObj;
float hex(vec2 p){
  p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5;
  p = abs(fract(p) - 0.5);
  return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
}
void main(){
  float f = 1.0 - abs(dot(normalize(vNV), normalize(-vPV)));
  float rim = pow(f, 2.4);
  vec2 uv = vec2(atan(vObj.z, vObj.x) * 2.2, vObj.y * 4.0 + uTime * 0.15);
  float h = 1.0 - smoothstep(0.0, 0.09, hex(uv * 2.0));
  float scan = 0.5 + 0.5 * sin(vObj.y * 18.0 - uTime * 4.0);
  float a = (rim * 0.9 + h * 0.22 * (0.4 + rim) + scan * 0.04) * uStrength;
  a += uHit * (0.35 + rim);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

type RingSlot = { mesh: Mesh | null; mat: MeshBasicMaterial; start: number; dur: number; maxScale: number; active: boolean };
type GlowSlot = { sprite: Sprite | null; mat: SpriteMaterial; start: number; dur: number; scale: number; peak: number; active: boolean };

const HAZARDS = new Set<string>(["micrometeoroid", "solar-flare", "radiation-belt", "space-debris", "thermal-spike", "nav-anomaly"]);

const tmpV = new Vector3();
const tmpQ = new Quaternion();
const dummy = new Object3D();
const col = new Color();

export interface ShipFxProps {
  shipId: string;
  isViewer: boolean;
  control: ShipControl;
}

export function ShipFx({ shipId, isViewer, control }: ShipFxProps) {
  const { camera, gl } = useThree();
  const billboard = useRef<Group>(null);
  const shield = useRef<Mesh>(null);
  const warnSprite = useRef<Sprite>(null);
  const warnRing = useRef<Mesh>(null);
  const blockedRing = useRef<Mesh>(null);
  const immuneRing = useRef<Mesh>(null);

  const res = useMemo(() => {
    const g = getShipGeometries();
    const m = getShipMaterials();
    const ringGeo = new RingGeometry(0.92, 1, 64);
    const rings: RingSlot[] = [];
    for (let i = 0; i < 4; i++) {
      const mat = new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
      rings.push({ mesh: null, mat, start: 0, dur: 1, maxScale: 1, active: false });
    }
    const glows: GlowSlot[] = [];
    for (let i = 0; i < 3; i++) {
      const mat = makeGlowSprite("#ffffff", 0);
      glows.push({ sprite: null, mat, start: 0, dur: 1, scale: 1, peak: 1, active: false });
    }
    const shieldMat = new ShaderMaterial({
      vertexShader: shieldVert,
      fragmentShader: shieldFrag,
      uniforms: { uColor: { value: new Color("#6fe3ff") }, uStrength: { value: 0 }, uTime: { value: 0 }, uHit: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    // stun arcs
    const ARC_SEGS = 3 * 8;
    const arcGeo = new BufferGeometry();
    arcGeo.setAttribute("position", new BufferAttribute(new Float32Array(ARC_SEGS * 2 * 3), 3));
    const arcMat = new LineBasicMaterial({ color: "#bfe8ff", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const arcs = new LineSegments(arcGeo, arcMat);
    arcs.frustumCulled = false;
    // micrometeoroid streaks
    const STREAKS = 16;
    const streakGeo = new BufferGeometry();
    streakGeo.setAttribute("position", new BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3));
    streakGeo.setAttribute("color", new BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3));
    const streakMat = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const streaks = new LineSegments(streakGeo, streakMat);
    streaks.frustumCulled = false;
    const streakSeeds = Array.from({ length: STREAKS }, () => ({ ox: Math.random() - 0.5, oy: Math.random() - 0.5, delay: Math.random() * 0.35, len: 0.3 + Math.random() * 0.5 }));
    // debris shards
    const SHARDS = 16;
    const shards = new InstancedMesh(g.shard, m.metal, SHARDS);
    shards.frustumCulled = false;
    const shardSeeds = Array.from({ length: SHARDS }, () => ({
      d: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      sp: 0.6 + Math.random() * 1.4,
      rot: new Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8),
      s: 0.5 + Math.random() * 1.1,
    }));
    const sparks = new ParticleSystem(140, true);
    sparks.drag = 1.4;
    const warnMat = new SpriteMaterial({ map: getWarningTexture(), color: "#ffcc33", transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    const warnRingMat = new MeshBasicMaterial({ color: "#ffcc33", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    const statusRingGeo = new RingGeometry(0.6, 0.64, 48, 1, 0, Math.PI * 1.5);
    const blockedMat = new MeshBasicMaterial({ color: "#ff3d5a", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    const immuneMat = new MeshBasicMaterial({ color: "#ffd45a", transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    return {
      ringGeo, rings, glows, shieldMat, arcs, arcMat, streaks, streakSeeds, shards, shardSeeds, sparks,
      warnMat, warnRingMat, statusRingGeo, blockedMat, immuneMat, sphere: g.sphere,
    };
  }, []);

  useEffect(
    () => () => {
      res.ringGeo.dispose();
      res.rings.forEach((r) => r.mat.dispose());
      res.glows.forEach((gl2) => gl2.mat.dispose());
      res.shieldMat.dispose();
      res.arcs.geometry.dispose();
      res.arcMat.dispose();
      res.streaks.geometry.dispose();
      (res.streaks.material as LineBasicMaterial).dispose();
      res.shards.dispose();
      res.sparks.dispose();
      res.warnMat.dispose();
      res.warnRingMat.dispose();
      res.statusRingGeo.dispose();
      res.blockedMat.dispose();
      res.immuneMat.dispose();
    },
    [res],
  );

  const st = useRef({
    streakStart: -10,
    streakColor: new Color("#ffe2a8"),
    shardStart: -10,
    shardSpeed: 1,
    arcBurstUntil: -10,
    arcColor: new Color("#bfe8ff"),
    arcNext: 0,
    jitterUntil: -10,
    shieldHit: 0,
    shieldLevel: 0,
    repairPulse: 0,
    warnLevel: 0,
    blocked: 0,
    immune: 0,
  });

  const fireRing = (now: number, c: string, dur: number, maxScale: number) => {
    const slot = res.rings.find((r) => !r.active) ?? res.rings.reduce((a, b) => (a.start < b.start ? a : b));
    slot.active = true;
    slot.start = now;
    slot.dur = dur;
    slot.maxScale = maxScale;
    slot.mat.color.set(c);
  };
  const fireGlow = (now: number, c: string, dur: number, scale: number, peak = 1) => {
    const slot = res.glows.find((r) => !r.active) ?? res.glows.reduce((a, b) => (a.start < b.start ? a : b));
    slot.active = true;
    slot.start = now;
    slot.dur = dur;
    slot.scale = scale;
    slot.peak = peak;
    slot.mat.color.set(c);
  };
  const burst = (n: number, c: string, speed: number, life: number, size: number, mode: "burst" | "rise" | "swirl" = "burst") => {
    col.set(c);
    for (let i = 0; i < n; i++) {
      tmpV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      if (mode === "rise") {
        const a = Math.random() * Math.PI * 2;
        const r = 0.2 + Math.random() * 0.35;
        res.sparks.emit(Math.cos(a) * r, (Math.random() - 0.5) * 0.2, Math.sin(a) * r, 0, 0.35 + Math.random() * 0.4, 0, col, life * (0.6 + Math.random() * 0.6), size, size * 0.4, 0, 1.2);
      } else if (mode === "swirl") {
        const a = Math.random() * Math.PI * 2;
        const r = 0.15 + Math.random() * 0.2;
        res.sparks.emit(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.4, Math.cos(a) * speed, Math.sin(a) * speed, -0.3, col, life * (0.7 + Math.random() * 0.5), size, size * 0.3, 5, 1.2);
      } else {
        const sp = speed * (0.4 + Math.random() * 0.8);
        res.sparks.emit(0, 0, 0, tmpV.x * sp, tmpV.y * sp, tmpV.z * sp, col, life * (0.5 + Math.random() * 0.7), size, size * 0.2, 0, 1.3);
      }
    }
  };

  const trigger = (kind: FxKind, now: number) => {
    const s = st.current;
    if (HAZARDS.has(kind) && s.shieldLevel > 0.05) s.shieldHit = 1;
    switch (kind) {
      case "micrometeoroid":
        s.streakStart = now;
        s.streakColor.set(HAZARD_COLORS.micrometeoroid);
        burst(18, "#fff2c4", 1.6, 0.5, 0.12);
        fireRing(now, "#ffe7b0", 0.5, 0.8);
        break;
      case "solar-flare":
        fireGlow(now, HAZARD_COLORS["solar-flare"], 1.6, 3.6, 0.9);
        fireGlow(now, "#fff0c8", 0.6, 1.4, 1);
        fireRing(now, HAZARD_COLORS["solar-flare"], 1.1, 2.4);
        burst(24, "#ffb24a", 1.2, 0.9, 0.12);
        break;
      case "radiation-belt":
        fireRing(now, HAZARD_COLORS["radiation-belt"], 1.0, 1.8);
        fireRing(now + 0.25, "#d9a8ff", 1.0, 1.4);
        fireGlow(now, HAZARD_COLORS["radiation-belt"], 1.2, 2.0, 0.6);
        burst(26, "#c48bff", 0.9, 1.0, 0.1, "swirl");
        break;
      case "space-debris":
      case "debris-scatter":
        s.shardStart = now;
        s.shardSpeed = kind === "debris-scatter" ? 1.4 : 1;
        burst(20, "#ffffff", 1.8, 0.45, 0.1);
        fireRing(now, "#dfe8f5", 0.5, 0.9);
        break;
      case "thermal-spike":
        fireGlow(now, HAZARD_COLORS["thermal-spike"], 1.8, 1.8, 0.9);
        fireGlow(now, "#ffa060", 0.8, 1.0, 0.8);
        burst(20, "#ff6a3d", 0.5, 1.2, 0.1, "rise");
        break;
      case "nav-anomaly":
        fireRing(now, HAZARD_COLORS["nav-anomaly"], 0.7, 1.4);
        fireRing(now + 0.18, "#7fb0ff", 0.7, 1.2);
        fireRing(now + 0.36, "#a8c8ff", 0.7, 1.0);
        fireGlow(now, HAZARD_COLORS["nav-anomaly"], 1.0, 1.6, 0.5);
        s.jitterUntil = now + 0.9;
        break;
      case "repair":
      case "hull-patch":
      case "repair-done":
        burst(kind === "repair" ? 14 : 30, "#5dff9c", 0.4, 1.4, 0.13, "rise");
        fireGlow(now, "#5dff9c", 0.9, 1.2, 0.5);
        if (kind !== "repair") fireRing(now, "#7dffb0", 0.8, 1.2);
        break;
      case "gravity-assist":
        burst(46, "#9fd8ff", 1.3, 1.3, 0.12, "swirl");
        burst(20, "#d1a8ff", 1.0, 1.1, 0.1, "swirl");
        fireRing(now, "#8fd0ff", 1.0, 2.2);
        fireRing(now + 0.15, "#c49bff", 1.0, 1.7);
        fireGlow(now, "#e0f2ff", 0.6, 1.6, 0.9);
        break;
      case "thruster-burn":
        fireRing(now, "#ffd9a0", 0.6, 1.0);
        fireGlow(now, "#fff2dc", 0.5, 1.3, 0.9);
        burst(16, "#ffcf7a", 1.4, 0.5, 0.08);
        break;
      case "deflector-surge":
        s.shieldHit = 1;
        fireRing(now, "#6fe3ff", 0.8, 1.6);
        fireGlow(now, "#6fe3ff", 0.7, 1.6, 0.6);
        break;
      case "navigation-lock":
        fireRing(now, "#ffd45a", 0.9, 1.3);
        fireRing(now + 0.2, "#fff0b0", 0.9, 1.0);
        fireGlow(now, "#ffd45a", 0.7, 1.1, 0.5);
        break;
      case "ion-jammer":
        s.arcBurstUntil = now + 1.2;
        s.arcColor.set("#5fa8ff");
        fireRing(now, "#5fa8ff", 0.8, 1.3);
        fireGlow(now, "#3d7bff", 1.0, 1.4, 0.5);
        break;
      case "emp-pulse":
        s.arcBurstUntil = now + 1.0;
        s.arcColor.set("#d8f4ff");
        fireRing(now, "#e4f6ff", 0.6, 2.4);
        fireRing(now + 0.1, "#8fdcff", 0.8, 1.8);
        fireGlow(now, "#cdeeff", 0.5, 2.0, 1);
        burst(24, "#bfe8ff", 2.0, 0.4, 0.08);
        break;
      case "tractor-lock":
        fireRing(now, "#ff5fd2", 0.9, 1.4);
        fireGlow(now, "#ff5fd2", 1.0, 1.4, 0.6);
        break;
      case "comms-spoof":
        s.arcBurstUntil = now + 0.6;
        s.arcColor.set("#ff3d5a");
        fireRing(now, "#ff3d5a", 0.7, 1.2);
        fireGlow(now, "#ff3d5a", 0.6, 1.0, 0.5);
        break;
      case "explode":
        fireGlow(now, "#ffffff", 0.45, 2.6, 1);
        fireGlow(now, "#ff9a3d", 1.6, 4.2, 1);
        fireGlow(now + 0.1, "#ff4d1d", 2.2, 3.0, 0.8);
        fireRing(now, "#ffd29a", 1.2, 3.2);
        fireRing(now + 0.12, "#ff7a3d", 1.4, 2.4);
        s.shardStart = now;
        s.shardSpeed = 1.6;
        burst(70, "#ffb060", 2.4, 1.4, 0.14);
        burst(30, "#ffffff", 3.2, 0.6, 0.1);
        break;
      default:
        break;
    }
  };

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const now = state.clock.elapsedTime;
    const s = st.current;
    const bb = billboard.current;
    if (!bb || !bb.parent) return;

    // Billboard group faces the camera regardless of ship orientation.
    bb.parent.getWorldQuaternion(tmpQ);
    bb.quaternion.copy(tmpQ.invert().multiply(camera.quaternion));

    const queued = fxBus.drain(shipId);
    if (queued) for (const k of queued) trigger(k, now);

    // --- snapshot-driven continuous states
    const snap = renderBridge.curr;
    const ship = snap?.spacecraft.find((x) => x.id === shipId);
    let shieldTarget = 0;
    let blocked = 0;
    let immune = 0;
    let stunned = false;
    if (ship && ship.phase !== "destroyed") {
      for (const e of ship.effects) {
        if (e.type === "damage-reduction") shieldTarget = Math.max(shieldTarget, 0.5 + e.magnitude * 0.6);
        else if (e.type === "abilities-blocked") blocked = 1;
        else if (e.type === "slow-immunity") immune = 1;
        else if (e.type === "stunned") stunned = true;
      }
      if (ship.repair) {
        s.repairPulse += dt;
        if (s.repairPulse > 0.8) {
          s.repairPulse = 0;
          burst(6, "#5dff9c", 0.3, 1.2, 0.1, "rise");
        }
      }
    }
    s.shieldLevel += (shieldTarget - s.shieldLevel) * (1 - Math.exp(-dt * 5));
    s.shieldHit = Math.max(0, s.shieldHit - dt * 2.2);
    const sh = shield.current;
    if (sh) {
      sh.visible = s.shieldLevel > 0.01 || s.shieldHit > 0.01;
      res.shieldMat.uniforms.uStrength.value = s.shieldLevel * (0.9 + 0.1 * Math.sin(now * 6));
      res.shieldMat.uniforms.uHit.value = s.shieldHit * Math.max(0.3, s.shieldLevel);
      res.shieldMat.uniforms.uTime.value = now;
    }
    s.blocked += (blocked - s.blocked) * (1 - Math.exp(-dt * 6));
    s.immune += (immune - s.immune) * (1 - Math.exp(-dt * 6));
    if (blockedRing.current) {
      blockedRing.current.visible = s.blocked > 0.01;
      blockedRing.current.rotation.z = now * 2.2;
      res.blockedMat.opacity = s.blocked * (0.55 + 0.35 * (Math.random() < 0.1 ? 0 : 1));
    }
    if (immuneRing.current) {
      immuneRing.current.visible = s.immune > 0.01;
      immuneRing.current.rotation.z = -now * 1.4;
      res.immuneMat.opacity = s.immune * 0.6;
    }

    // --- hazard warning
    let soon: { type: HazardType; ms: number } | null = null;
    if (snap && ship && ship.phase !== "destroyed") {
      const since = performance.now() - renderBridge.currAt;
      for (const h of snap.hazards) {
        if (h.shipId !== shipId || h.resolved || h.strikesInMs <= 0) continue;
        const ms = h.strikesInMs - since;
        if (ms > -200 && (!soon || ms < soon.ms)) soon = { type: h.type, ms };
      }
    }
    s.warnLevel += ((soon ? 1 : 0) - s.warnLevel) * (1 - Math.exp(-dt * 8));
    if (warnSprite.current && warnRing.current) {
      const vis = s.warnLevel > 0.01;
      warnSprite.current.visible = vis;
      warnRing.current.visible = vis;
      if (soon) {
        res.warnMat.color.set(HAZARD_COLORS[soon.type]);
        res.warnRingMat.color.set(HAZARD_COLORS[soon.type]);
      }
      const urgency = soon ? 1 - Math.min(1, Math.max(0, soon.ms) / 4000) : 0;
      const freq = 2 + urgency * 8;
      const pulse = 0.5 + 0.5 * Math.sin(now * freq * Math.PI);
      const base = isViewer ? 0.42 : 0.34;
      const sc = base * (1 + pulse * 0.18);
      warnSprite.current.scale.set(sc, sc, 1);
      res.warnMat.opacity = s.warnLevel * (0.65 + pulse * 0.35);
      const rp = (now * (0.8 + urgency * 1.6)) % 1;
      const rs = 0.5 + rp * 0.5;
      warnRing.current.scale.set(rs, rs, rs);
      res.warnRingMat.opacity = s.warnLevel * (1 - rp) * 0.8;
    }

    // --- stun arcs
    const arcsOn = stunned || now < s.arcBurstUntil;
    res.arcs.visible = arcsOn;
    if (arcsOn) {
      if (stunned && now >= s.arcBurstUntil) s.arcColor.set("#bfe8ff");
      res.arcMat.color.copy(s.arcColor);
      res.arcMat.opacity = Math.random() < 0.25 ? 0.25 : 1;
      if (now > s.arcNext) {
        s.arcNext = now + 0.05 + Math.random() * 0.05;
        const pos = res.arcs.geometry.getAttribute("position") as BufferAttribute;
        const arr = pos.array as Float32Array;
        let k = 0;
        for (let a = 0; a < 3; a++) {
          const a0 = Math.random() * Math.PI * 2;
          const a1 = a0 + (Math.random() - 0.5) * 2.4;
          let px = Math.cos(a0) * 0.42;
          let py = (Math.random() - 0.5) * 0.4;
          let pz = Math.sin(a0) * 0.42;
          for (let i = 1; i <= 8; i++) {
            const tt = i / 8;
            const aa = a0 + (a1 - a0) * tt;
            const r = 0.42 + (Math.random() - 0.5) * 0.16;
            const nx = Math.cos(aa) * r;
            const ny = py + (Math.random() - 0.5) * 0.14;
            const nz = Math.sin(aa) * r;
            arr[k++] = px; arr[k++] = py; arr[k++] = pz;
            arr[k++] = nx; arr[k++] = ny; arr[k++] = nz;
            px = nx; py = ny; pz = nz;
          }
        }
        pos.needsUpdate = true;
      }
    }

    // --- nav anomaly jitter
    control.jitter = now < s.jitterUntil ? (s.jitterUntil - now) / 0.9 : 0;

    // --- rings & glows
    for (const r of res.rings) {
      const mesh = r.mesh;
      if (!mesh) continue;
      const t = (now - r.start) / r.dur;
      if (!r.active || t < 0 || t >= 1) {
        if (t >= 1) r.active = false;
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const e = 1 - Math.pow(1 - t, 3);
      const sc = 0.15 + e * r.maxScale;
      mesh.scale.set(sc, sc, sc);
      r.mat.opacity = Math.pow(1 - t, 1.5) * 0.9;
    }
    for (const gs of res.glows) {
      const sp = gs.sprite;
      if (!sp) continue;
      const t = (now - gs.start) / gs.dur;
      if (!gs.active || t < 0 || t >= 1) {
        if (t >= 1) gs.active = false;
        sp.visible = false;
        continue;
      }
      sp.visible = true;
      const inT = Math.min(1, t / 0.08);
      const sc = gs.scale * (0.6 + 0.4 * Math.sqrt(t));
      sp.scale.set(sc, sc, 1);
      gs.mat.opacity = gs.peak * inT * Math.pow(1 - t, 1.3);
    }

    // --- streaks (micrometeoroids)
    const sT = now - s.streakStart;
    res.streaks.visible = sT < 0.9;
    if (res.streaks.visible) {
      const pos = res.streaks.geometry.getAttribute("position") as BufferAttribute;
      const cl = res.streaks.geometry.getAttribute("color") as BufferAttribute;
      const pa = pos.array as Float32Array;
      const ca = cl.array as Float32Array;
      res.streakSeeds.forEach((sd, i) => {
        const lt = (sT - sd.delay) / 0.45;
        const o = i * 6;
        if (lt < 0 || lt > 1) {
          pa.fill(0, o, o + 6);
          ca.fill(0, o, o + 6);
          return;
        }
        // Streaks fly diagonally across the ship.
        const x = -1.6 + lt * 3.2;
        const hx = x + sd.len;
        const yy = sd.oy * 0.7;
        const zz = sd.ox * 0.9;
        pa[o] = x; pa[o + 1] = yy + x * 0.25; pa[o + 2] = zz - x * 0.3;
        pa[o + 3] = hx; pa[o + 4] = yy + hx * 0.25; pa[o + 5] = zz - hx * 0.3;
        const f = Math.sin(lt * Math.PI);
        ca[o] = 0; ca[o + 1] = 0; ca[o + 2] = 0;
        ca[o + 3] = s.streakColor.r * f * 1.5; ca[o + 4] = s.streakColor.g * f * 1.5; ca[o + 5] = s.streakColor.b * f * 1.5;
      });
      pos.needsUpdate = true;
      cl.needsUpdate = true;
    }

    // --- shards (debris)
    const dT = now - s.shardStart;
    res.shards.visible = dT < 1.6;
    if (res.shards.visible) {
      res.shardSeeds.forEach((sd, i) => {
        const travel = sd.sp * s.shardSpeed * (1 - Math.exp(-dT * 2.2)) * 0.9;
        dummy.position.copy(sd.d).multiplyScalar(0.15 + travel);
        dummy.rotation.set(sd.rot.x * dT, sd.rot.y * dT, sd.rot.z * dT);
        const fade = Math.max(0, 1 - dT / 1.6);
        dummy.scale.setScalar(sd.s * fade);
        dummy.updateMatrix();
        res.shards.setMatrixAt(i, dummy.matrix);
      });
      res.shards.instanceMatrix.needsUpdate = true;
    }

    res.sparks.setScaleFromCamera(camera, gl);
    res.sparks.update(dt);
  });

  return (
    <group>
      <mesh ref={shield} geometry={res.sphere} material={res.shieldMat} scale={[0.82, 0.55, 0.78]} visible={false} renderOrder={6} />
      <primitive object={res.arcs} />
      <primitive object={res.streaks} />
      <primitive object={res.shards} />
      <primitive object={res.sparks.points} />
      <group ref={billboard}>
        {res.rings.map((r, i) => (
          <mesh
            key={`r${i}`}
            ref={(el: Mesh | null) => {
              if (el) r.mesh = el;
            }}
            geometry={res.ringGeo}
            material={r.mat}
            visible={false}
            renderOrder={7}
          />
        ))}
        {res.glows.map((gs, i) => (
          <sprite
            key={`g${i}`}
            ref={(el: Sprite | null) => {
              if (el) gs.sprite = el;
            }}
            material={gs.mat}
            visible={false}
            renderOrder={7}
          />
        ))}
        <mesh ref={blockedRing} geometry={res.statusRingGeo} material={res.blockedMat} visible={false} />
        <mesh ref={immuneRing} geometry={res.statusRingGeo} material={res.immuneMat} visible={false} scale={1.12} />
        <mesh ref={warnRing} geometry={res.ringGeo} material={res.warnRingMat} visible={false} renderOrder={8} />
      </group>
      <sprite ref={warnSprite} material={res.warnMat} position={[0, 0.62, 0]} visible={false} renderOrder={20} />
    </group>
  );
}
