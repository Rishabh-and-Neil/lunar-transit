import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Color, type Group, MathUtils, Matrix4, type Mesh, Quaternion, type Sprite, Vector3 } from "three";
import { ROUTE, type AttachmentId } from "@sm/shared";
import { renderBridge } from "../state/renderBridge";
import {
  LUNAR_ORBIT_RADIUS,
  LUNAR_ORBIT_SPEED,
  SHIP_SCALE,
  VIEWER_COLOR,
  lunarOrbitAngleOf,
  lunarOrbitPoint,
  sampleRoute,
} from "./constants";
import { fxBus, type ShipLive } from "./fxBus";
import { ParticleSystem } from "./particles";
import { getAccentMaterial, getShipGeometries, getShipMaterials, makeFlameMaterial, makeGlowSprite } from "./shipParts";
import { ShipFx } from "./ShipFx";

/** Mutable per-frame drive values for a ship model (never React state). */
export interface ShipControl {
  thrust: number; // 0..3 (1 = cruise)
  boost: number; // 0..1
  slow: number; // 0..1
  stun: number; // 0..1
  repairing: number; // 0..1
  jitter: number; // 0..1 nav-anomaly shake
}

export function createShipControl(thrust = 0.7): ShipControl {
  return { thrust, boost: 0, slow: 0, stun: 0, repairing: 0, jitter: 0 };
}

export interface ShipModelProps {
  attachments: readonly AttachmentId[];
  hasRepairDrone: boolean;
  repairUpgraded?: boolean;
  /** Accent / exhaust colour. Defaults to the viewer colour. */
  accent?: string;
  /** Optional live control object, mutated by the owner every frame. */
  control?: ShipControl;
}

const WHITE_HOT = new Color("#e8f7ff");
const SLOW_BLUE = new Color("#2f5dff");
const tmpColor = new Color();

/**
 * Stylized low-poly spacecraft built from primitives (nose = +Z, engine = -Z).
 * Roughly 1.2 units long; wings span ~2.3 units (3.7 with the deployable array).
 */
export function ShipModel({ attachments, hasRepairDrone, repairUpgraded = false, accent = VIEWER_COLOR, control }: ShipModelProps) {
  const g = getShipGeometries();
  const m = getShipMaterials();
  const accentMat = getAccentMaterial(accent);
  const key = attachments.join(",");
  const has = useMemo(() => new Set<AttachmentId>(attachments), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const local = useMemo(
    () => ({
      flame: makeFlameMaterial(accent),
      engineGlow: makeGlowSprite(accent, 0.9),
      ionFlame: makeFlameMaterial("#5fb4ff"),
      ionGlow: makeGlowSprite("#5fb4ff", 0.8),
      chemFlame: makeFlameMaterial("#ff9a3d"),
      chemGlow: makeGlowSprite("#ff8a2a", 0.8),
      navRed: makeGlowSprite("#ff3b3b"),
      navGreen: makeGlowSprite("#3bff7a"),
      beacon: makeGlowSprite(accent),
      puff: makeGlowSprite("#e6f2ff", 0),
      droneLight: makeGlowSprite("#5dff9c"),
      deflectorGlow: makeGlowSprite("#9a6bff", 0.18),
      glint: makeGlowSprite("#9ff3ff", 0.8),
      dishLight: makeGlowSprite("#ffe36b"),
    }),
    [accent],
  );
  useEffect(() => () => Object.values(local).forEach((mat) => mat.dispose()), [local]);

  const fallback = useRef<ShipControl>(createShipControl());
  const flame = useRef<Mesh>(null);
  const engineGlow = useRef<Sprite>(null);
  const navRed = useRef<Sprite>(null);
  const navGreen = useRef<Sprite>(null);
  const beacon = useRef<Sprite>(null);
  const deflector = useRef<Group>(null);
  const sail = useRef<Group>(null);
  const drones = useRef<Group>(null);
  const puff = useRef<Sprite>(null);
  const subFlames = useRef<Group>(null);
  const dishLight = useRef<Sprite>(null);
  const baseColor = useMemo(() => new Color(accent), [accent]);
  const puffState = useRef({ next: 1, t: 0 });

  const extended = has.has("solar-array");
  const tipX = extended ? 1.88 : 1.16;

  useFrame((state, dt) => {
    const c = control ?? fallback.current;
    const t = state.clock.elapsedTime;
    const stunFlicker = c.stun > 0.05 ? (Math.random() < 0.4 ? 0.1 : 0.7) : 1;
    const power = Math.max(0, (0.35 + c.thrust * 0.5 + c.boost * 1.0) * (1 - c.slow * 0.5) * (1 - c.stun * 0.85) * stunFlicker);

    if (flame.current) {
      const len = 0.22 + c.thrust * 0.2 + c.boost * 0.75 - c.slow * 0.1;
      const w = 0.105 + c.boost * 0.03 - c.slow * 0.02;
      const wob = 1 + Math.sin(t * 47) * 0.04;
      flame.current.scale.set(w * wob, w * wob, Math.max(0.05, len * (1 + Math.sin(t * 31) * 0.05)));
      const fm = local.flame;
      tmpColor.copy(baseColor).lerp(WHITE_HOT, c.boost * 0.6).lerp(SLOW_BLUE, c.slow * 0.7);
      (fm.uniforms.uColor.value as Color).copy(tmpColor);
      fm.uniforms.uIntensity.value = power * 1.5;
      fm.uniforms.uTime.value = t;
      local.engineGlow.color.copy(tmpColor);
    }
    if (engineGlow.current) {
      const s = 0.45 + power * 0.45;
      engineGlow.current.scale.set(s, s, 1);
      local.engineGlow.opacity = Math.min(1, power * 0.75);
    }
    if (subFlames.current) {
      const p = power * 0.9;
      local.ionFlame.uniforms.uIntensity.value = p * 1.3;
      local.ionFlame.uniforms.uTime.value = t;
      local.chemFlame.uniforms.uIntensity.value = p * 1.4;
      local.chemFlame.uniforms.uTime.value = t;
      local.ionGlow.opacity = Math.min(1, p * 0.8);
      local.chemGlow.opacity = Math.min(1, p * 0.8);
      for (const child of subFlames.current.children) {
        const k = child.userData.len as number | undefined;
        if (k) child.scale.z = k * (0.6 + p * 0.5 + c.boost * 0.4) * (1 + Math.sin(t * 40 + child.id) * 0.06);
      }
    }
    const blink = (offset: number) => (((t + offset) % 1.6) < 0.1 ? 1 : 0.08);
    local.navRed.opacity = blink(0);
    local.navGreen.opacity = blink(0.8);
    local.beacon.opacity = 0.45 + 0.4 * Math.sin(t * 3.2);
    local.dishLight.opacity = blink(0.4);
    if (deflector.current) {
      deflector.current.rotation.z = t * 0.9;
      const pulse = 0.85 + 0.15 * Math.sin(t * 5);
      deflector.current.scale.setScalar(pulse);
    }
    if (sail.current) {
      sail.current.rotation.z = Math.sin(t * 0.7) * 0.06;
      sail.current.rotation.x = -0.9 + Math.sin(t * 0.9) * 0.04;
    }
    if (drones.current) {
      const n = drones.current.children.length;
      const r = MathUtils.lerp(0.85, 0.5, c.repairing);
      const speed = 0.9 + c.repairing * 2.2;
      for (let i = 0; i < n; i++) {
        const d = drones.current.children[i];
        const a = t * speed + (i * Math.PI * 2) / n;
        d.position.set(Math.cos(a) * r, 0.22 + Math.sin(t * 2.1 + i * 1.7) * 0.06, Math.sin(a) * r * 0.85 + 0.05);
        d.rotation.y = -a;
        d.rotation.x = t * 1.3;
      }
    }
    if (puff.current) {
      const ps = puffState.current;
      ps.t += dt;
      if (ps.t > ps.next) {
        ps.t = 0;
        ps.next = 0.8 + Math.random() * 2.5;
        const k = Math.floor(Math.random() * 4);
        const ang = Math.PI / 4 + (k * Math.PI) / 2;
        puff.current.position.set(Math.cos(ang) * 0.36, Math.sin(ang) * 0.36, 0.42);
      }
      const life = ps.t / 0.35;
      local.puff.opacity = life < 1 ? (1 - life) * 0.9 : 0;
      const s = 0.06 + life * 0.18;
      puff.current.scale.set(s, s, 1);
    }
  });

  const wing = (side: 1 | -1) => (
    <group key={side} rotation={[0.35 * side, 0, 0]}>
      <mesh geometry={g.boom} material={m.metal} position={[side * 0.37, 0, 0]} scale={[0.26, 1, 1]} />
      <mesh geometry={g.yoke} material={m.dark} position={[side * 0.47, 0, 0]} />
      <mesh geometry={g.panel} material={m.panel} position={[side * 0.83, 0, 0]} />
      {extended && <mesh geometry={g.panel} material={m.panel} position={[side * 1.55, 0, 0]} />}
      {extended && <mesh geometry={g.yoke} material={m.dark} position={[side * 1.19, 0, 0]} scale={[0.6, 0.8, 1]} />}
      <sprite ref={side === -1 ? navRed : navGreen} material={side === -1 ? local.navRed : local.navGreen} position={[side * tipX, 0.02, 0]} scale={[0.18, 0.18, 1]} />
    </group>
  );

  return (
    <group>
      {/* Crew module */}
      <mesh geometry={g.capsule} material={m.hull} position={[0, 0, 0.56]} />
      <mesh geometry={g.dockTip} material={m.metal} position={[0, 0, 0.75]} />
      {[-0.07, 0.07].map((x) => (
        <mesh key={x} geometry={g.window} material={m.windowGlass} position={[x, 0.155, 0.6]} rotation={[-0.62, 0, 0]} />
      ))}
      <mesh geometry={g.band} material={accentMat} position={[0, 0, 0.43]} />
      <mesh geometry={g.adapter} material={m.dark} position={[0, 0, 0.375]} />
      <sprite ref={beacon} material={local.beacon} position={[0, 0.2, 0.52]} scale={[0.16, 0.16, 1]} />

      {/* Service module */}
      <mesh geometry={has.has("thermal-blanket") ? g.foil : g.service} material={has.has("thermal-blanket") ? m.gold : m.metal} position={[0, 0, 0.1]} />
      <mesh geometry={g.smBand} material={m.dark} position={[0, 0, 0.3]} />
      <mesh geometry={g.smBand} material={accentMat} position={[0, 0, -0.08]} scale={[1, 1, 0.6]} />
      <mesh geometry={g.aft} material={has.has("thermal-blanket") ? m.gold : m.dark} position={[0, 0, -0.18]} />

      {/* Main engine */}
      <mesh geometry={g.nozzle} material={m.dark} position={[0, 0, -0.2]} />
      <mesh ref={flame} geometry={g.flame} material={local.flame} position={[0, 0, -0.4]} />
      <sprite ref={engineGlow} material={local.engineGlow} position={[0, 0, -0.44]} />

      {/* Solar wings */}
      {wing(1)}
      {wing(-1)}

      {/* ---- Shielding */}
      {has.has("whipple-shield") && (
        <group position={[0, 0, 0.1]}>
          <mesh geometry={g.whipple} material={m.shield} />
          <mesh geometry={g.whipple} material={m.shield} rotation={[0, 0, Math.PI]} />
        </group>
      )}
      {has.has("radiation-vault") && (
        <group>
          <mesh geometry={g.vaultRing} material={m.lead} position={[0, 0, 0.47]} />
          <mesh geometry={g.vaultStripe} material={m.hazardStripe} position={[0, 0, 0.47]} />
          <mesh geometry={g.vaultRing} material={m.lead} position={[0, 0, 0.24]} scale={[1.02, 1.02, 0.8]} />
        </group>
      )}
      {has.has("magnetic-deflector") && (
        <group>
          {[0, 1, 2, 3].map((k) => (
            <mesh key={k} geometry={g.coil} material={m.deflector} position={[Math.cos((k * Math.PI) / 2 + 0.78) * 0.26, Math.sin((k * Math.PI) / 2 + 0.78) * 0.26, 0.26]} />
          ))}
          <group ref={deflector}>
            <mesh geometry={g.deflectorRing} material={m.deflector} rotation={[1.2, 0, 0]} />
            <mesh geometry={g.deflectorRing} material={m.deflector} rotation={[-1.2, 0, 0]} />
          </group>
          <sprite material={local.deflectorGlow} scale={[1.9, 1.9, 1]} />
        </group>
      )}

      {/* ---- Propulsion */}
      <group ref={subFlames}>
        {has.has("ion-thruster") &&
          [-1, 1].map((s) => (
            <group key={`ion${s}`} position={[s * 0.24, 0.24, -0.1]}>
              <mesh geometry={g.pylon} material={m.dark} position={[-s * 0.06, -0.06, 0.02]} rotation={[0, 0, s * 0.8]} />
              <mesh geometry={g.pod} material={m.metal} />
              <mesh geometry={g.podGrid} material={m.ion} position={[0, 0, -0.135]} />
              <mesh geometry={g.flame} material={local.ionFlame} position={[0, 0, -0.14]} scale={[0.045, 0.045, 0.32]} userData={{ len: 0.32 }} />
              <sprite material={local.ionGlow} position={[0, 0, -0.16]} scale={[0.32, 0.32, 1]} />
            </group>
          ))}
        {has.has("chemical-booster") &&
          [-1, 1].map((s) => (
            <group key={`chem${s}`} position={[s * 0.25, -0.22, -0.02]}>
              <mesh geometry={g.booster} material={m.hull} />
              <mesh geometry={g.boosterNose} material={accentMat} position={[0, 0, 0.27]} />
              <mesh geometry={g.smallNozzle} material={m.dark} position={[0, 0, -0.21]} />
              <mesh geometry={g.flame} material={local.chemFlame} position={[0, 0, -0.3]} scale={[0.06, 0.06, 0.4]} userData={{ len: 0.4 }} />
              <sprite material={local.chemGlow} position={[0, 0, -0.32]} scale={[0.36, 0.36, 1]} />
            </group>
          ))}
      </group>
      {has.has("solar-sail") && (
        <group position={[0, 0.22, -0.12]}>
          <mesh geometry={g.mast} material={m.metal} position={[0, 0.3, -0.12]} scale={[1, 0.62, 1]} rotation={[-0.4, 0, 0]} />
          <group ref={sail} position={[0, 0.58, -0.36]} rotation={[-0.9, 0, 0]}>
            <mesh geometry={g.sail} material={m.sail} rotation={[0, 0, Math.PI / 4]} />
            <mesh geometry={g.sailBoom} material={m.metal} scale={[1.02, 1, 1]} />
            <mesh geometry={g.sailBoom} material={m.metal} scale={[1.02, 1, 1]} rotation={[0, 0, Math.PI / 2]} />
          </group>
        </group>
      )}
      {has.has("cold-gas-rcs") && (
        <group>
          {[0, 1, 2, 3].map((k) => {
            const a = Math.PI / 4 + (k * Math.PI) / 2;
            return (
              <group key={k} position={[Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.42]} rotation={[0, 0, a]}>
                <mesh geometry={g.rcsBlock} material={m.dark} />
                <mesh geometry={g.rcsNozzle} material={m.metal} position={[0.03, 0, 0.04]} />
                <mesh geometry={g.rcsNozzle} material={m.metal} position={[0.03, 0, -0.04]} rotation={[Math.PI, 0, 0]} />
              </group>
            );
          })}
          <sprite ref={puff} material={local.puff} />
        </group>
      )}

      {/* ---- Instruments */}
      {has.has("star-tracker") && (
        <group position={[-0.13, 0.24, 0.22]} rotation={[-0.5, 0, 0.3]}>
          <mesh geometry={g.trackerBox} material={m.dark} />
          <mesh geometry={g.trackerHood} material={m.lens} position={[0, 0.06, 0.01]} />
          <sprite material={local.glint} position={[0, 0.07, 0.01]} scale={[0.08, 0.08, 1]} />
        </group>
      )}
      {has.has("deep-space-transponder") && (
        <group position={[0.1, 0.24, 0.02]}>
          <mesh geometry={g.dishBoom} material={m.metal} position={[0.03, 0.12, 0]} scale={[1, 0.25, 1]} rotation={[0, 0, -0.3]} />
          <group position={[0.08, 0.27, -0.02]} rotation={[0.6, 0, -0.35]}>
            <mesh geometry={g.dish} material={m.hull} />
            <mesh geometry={g.feed} material={m.dark} position={[0, 0.06, 0]} />
            <sprite ref={dishLight} material={local.dishLight} position={[0, 0.11, 0]} scale={[0.09, 0.09, 1]} />
          </group>
        </group>
      )}
      {has.has("spectrometer") && (
        <group position={[0, -0.27, 0.16]}>
          <mesh geometry={g.specBox} material={m.gold} />
          <mesh geometry={g.specAperture} material={m.lens} position={[0, -0.05, 0.03]} />
          <mesh geometry={g.specAperture} material={accentMat} position={[0, -0.04, -0.05]} scale={[0.5, 0.6, 0.5]} />
        </group>
      )}

      {/* ---- Repair drone(s) */}
      {hasRepairDrone && (
        <group ref={drones}>
          {(repairUpgraded ? [0, 1] : [0]).map((i) => (
            <group key={i}>
              <mesh geometry={g.droneBody} material={m.hull} />
              <mesh geometry={g.droneRing} material={repairUpgraded ? m.gold : m.green} />
              <sprite material={local.droneLight} scale={[0.22, 0.22, 1]} />
            </group>
          ))}
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Flight spacecraft (driven by renderBridge snapshots)

export interface SpacecraftProps {
  shipId: string;
  color: string;
  isViewer: boolean;
  /** Lateral offset (world units) so two ships never overlap. */
  lane: number;
  attachments: readonly AttachmentId[];
  hasRepairDrone: boolean;
  repairUpgraded: boolean;
}

const UP = new Vector3(0, 1, 0);
const ZERO = new Vector3();
const tmpPos = new Vector3();
const tmpTan = new Vector3();
const tmpLat = new Vector3();
const orbPos = new Vector3();
const orbTan = new Vector3();
const tmpMat = new Matrix4();
const tmpQuat = new Quaternion();
const rollQuat = new Quaternion();
const emitPos = new Vector3();
const emitVel = new Vector3();
const exhaustColor = new Color();
const SPARK_COLOR = new Color("#ffb04a");

export function Spacecraft({ shipId, color, isViewer, lane, attachments, hasRepairDrone, repairUpgraded }: SpacecraftProps) {
  const root = useRef<Group>(null);
  const model = useRef<Group>(null);
  const control = useMemo(() => createShipControl(0.15), []);
  const { camera, gl } = useThree();
  const exhaust = useMemo(() => new ParticleSystem(260), []);
  useEffect(() => () => exhaust.dispose(), [exhaust]);
  const base = useMemo(() => new Color(color), [color]);

  const live = useMemo<ShipLive>(() => ({ pos: new Vector3(), forward: new Vector3(1, 0, 0), frac: 0, alive: true }), []);
  useEffect(() => {
    fxBus.ships.set(shipId, live);
    return () => {
      if (fxBus.ships.get(shipId) === live) fxBus.ships.delete(shipId);
    };
  }, [shipId, live]);

  const s = useRef({
    init: false,
    frac: 0,
    seenAlive: false,
    destroyed: false,
    explodeAt: -100,
    orbitStart: -1,
    orbitAngle0: 0,
    emitAcc: 0,
    sparkAcc: 0,
  });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const r = root.current;
    if (!r) return;
    const snap = renderBridge.curr;
    const ship = snap?.spacecraft.find((x) => x.id === shipId);
    exhaust.setScaleFromCamera(camera, gl);
    if (!snap || !ship) {
      r.visible = false;
      live.alive = false;
      exhaust.update(dt);
      return;
    }
    r.visible = true;
    const st = s.current;
    const t = state.clock.elapsedTime;
    const phase = ship.phase;
    const destroyed = phase === "destroyed";

    if (destroyed && !st.destroyed) {
      st.destroyed = true;
      if (st.seenAlive) {
        st.explodeAt = t;
        fxBus.push(shipId, "explode");
        if (isViewer) {
          fxBus.kickShake(1);
          fxBus.screenFlash("#ff8a3d", 0.55);
        }
      } else {
        st.explodeAt = -100;
      }
    } else if (!destroyed) {
      st.destroyed = false;
      st.seenAlive = true;
    }
    if (model.current) model.current.visible = !destroyed || t - st.explodeAt < 0.12;

    // ---- position along route / lunar orbit
    const prog = renderBridge.progressOf(shipId, performance.now()) ?? ship.progress;
    const target = MathUtils.clamp(prog / ROUTE.distanceUnits, 0, 1);
    if (!st.init) st.frac = target;
    else if (!destroyed) st.frac = MathUtils.damp(st.frac, target, 4, dt);
    sampleRoute(st.frac, tmpPos, tmpTan);
    tmpLat.crossVectors(tmpTan, UP).normalize().multiplyScalar(lane * Math.min(1, st.frac * 30) );
    tmpPos.add(tmpLat);

    const orbiting = phase === "lunar-task" || phase === "task-complete";
    if (orbiting) {
      if (st.orbitStart < 0) {
        st.orbitStart = t;
        st.orbitAngle0 = lunarOrbitAngleOf(st.init ? r.position : tmpPos);
      }
      const el = t - st.orbitStart;
      const a = st.orbitAngle0 + el * LUNAR_ORBIT_SPEED * Math.min(1, el / 3) ;
      lunarOrbitPoint(a, orbPos, orbTan, LUNAR_ORBIT_RADIUS + lane * 0.8);
      const w = st.init ? MathUtils.smoothstep(el, 0, 2.5) : 1;
      tmpPos.lerp(orbPos, w);
      tmpTan.lerp(orbTan, w).normalize();
    } else {
      st.orbitStart = -1;
    }
    // Ships shrink a little in lunar orbit so the Moon stays the hero of the shot.
    const scaleTarget = orbiting ? 0.55 : 1;
    if (!st.init) r.scale.setScalar(scaleTarget);
    else r.scale.setScalar(MathUtils.damp(r.scale.x, scaleTarget, 1.5, dt));

    if (control.jitter > 0.01) {
      const j = control.jitter * 0.08;
      tmpPos.x += (Math.random() - 0.5) * j;
      tmpPos.y += (Math.random() - 0.5) * j;
      tmpPos.z += (Math.random() - 0.5) * j;
    }
    r.position.copy(tmpPos);
    tmpMat.lookAt(tmpTan, ZERO, UP);
    tmpQuat.setFromRotationMatrix(tmpMat);
    rollQuat.setFromAxisAngle(tmpTan, Math.sin(t * 0.6 + lane * 4) * 0.12);
    tmpQuat.premultiply(rollQuat);
    if (!st.init) r.quaternion.copy(tmpQuat);
    else r.quaternion.slerp(tmpQuat, 1 - Math.exp(-5 * dt));
    st.init = true;

    // ---- drive values from snapshot
    let boost = 0;
    let slow = 0;
    let stun = 0;
    for (const e of ship.effects) {
      if (e.type === "speed-multiplier") {
        if (e.magnitude > 0) boost = Math.max(boost, Math.min(1, 0.5 + e.magnitude));
        else slow = Math.max(slow, Math.min(1, 0.5 - e.magnitude));
      } else if (e.type === "stunned") stun = 1;
    }
    const active = snap.status === "active";
    const thrustTarget = destroyed ? 0 : orbiting ? 0.12 : !active ? 0.2 : MathUtils.clamp(ship.velocity / ROUTE.referenceSpeed, 0.2, 3);
    control.thrust = MathUtils.damp(control.thrust, thrustTarget, 3, dt);
    control.boost = MathUtils.damp(control.boost, destroyed ? 0 : boost, 4, dt);
    control.slow = MathUtils.damp(control.slow, destroyed ? 0 : slow, 4, dt);
    control.stun = MathUtils.damp(control.stun, destroyed ? 0 : stun, 8, dt);
    control.repairing = MathUtils.damp(control.repairing, ship.repair ? 1 : 0, 3, dt);

    live.pos.copy(r.position);
    live.forward.copy(tmpTan);
    live.frac = st.frac;
    live.alive = !destroyed;

    // ---- world-space exhaust trail
    if (!destroyed) {
      const power = (0.3 + control.thrust * 0.5 + control.boost) * (1 - control.stun * 0.9) * (1 - control.slow * 0.4);
      const rate = 26 + power * 30;
      st.emitAcc += dt * rate;
      exhaustColor.copy(base).lerp(WHITE_HOT, control.boost * 0.25).lerp(SLOW_BLUE, control.slow * 0.6);
      emitPos.copy(r.position).addScaledVector(tmpTan, -0.44 * SHIP_SCALE * r.scale.x);
      while (st.emitAcc >= 1) {
        st.emitAcc -= 1;
        const sp = 0.7 + power * 0.6 + control.boost * 1.1;
        emitVel.copy(tmpTan).multiplyScalar(-sp);
        emitVel.x += (Math.random() - 0.5) * 0.12;
        emitVel.y += (Math.random() - 0.5) * 0.12;
        emitVel.z += (Math.random() - 0.5) * 0.12;
        const life = 0.7 + Math.random() * 0.5 + control.boost * 0.9;
        exhaust.emit(
          emitPos.x + (Math.random() - 0.5) * 0.03, emitPos.y + (Math.random() - 0.5) * 0.03, emitPos.z + (Math.random() - 0.5) * 0.03,
          emitVel.x, emitVel.y, emitVel.z,
          exhaustColor, life, 0.1 + control.boost * 0.04, 0.34 + control.boost * 0.12, 0, 0.22 + Math.min(1.2, power) * 0.18,
        );
      }
      // sparks from a damaged hull
      const hpFrac = ship.health / Math.max(1, ship.maxHealth);
      if (hpFrac < 0.35) {
        st.sparkAcc += dt * (1 - hpFrac / 0.35) * 14;
        while (st.sparkAcc >= 1) {
          st.sparkAcc -= 1;
          exhaust.emit(
            r.position.x, r.position.y, r.position.z,
            (Math.random() - 0.5) * 0.9, Math.random() * 0.6, (Math.random() - 0.5) * 0.9,
            SPARK_COLOR, 0.35 + Math.random() * 0.3, 0.05, 0.02, 0, 1.4,
          );
        }
      }
    }
    exhaust.drag = 1.2;
    exhaust.update(dt);
  });

  return (
    <>
      <group ref={root}>
        <group ref={model} scale={SHIP_SCALE}>
          <ShipModel attachments={attachments} hasRepairDrone={hasRepairDrone} repairUpgraded={repairUpgraded} accent={color} control={control} />
        </group>
        <group scale={SHIP_SCALE / 0.8}>
          <ShipFx shipId={shipId} isViewer={isViewer} control={control} />
        </group>
      </group>
      <primitive object={exhaust.points} />
    </>
  );
}
