import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CylinderGeometry, DoubleSide, type Mesh, Quaternion, ShaderMaterial, Vector3 } from "three";
import type { AttachmentId, PublicMatchSnapshot } from "@sm/shared";
import { renderBridge } from "../state/renderBridge";
import { OPPONENT_COLOR, VIEWER_COLOR } from "./constants";
import { fxBus } from "./fxBus";
import { Spacecraft } from "./Spacecraft";

interface ShipDescriptor {
  id: string;
  isViewer: boolean;
  lane: number;
  attachments: AttachmentId[];
  hasRepairDrone: boolean;
  repairUpgraded: boolean;
}

function signatureOf(snap: PublicMatchSnapshot | null): string {
  if (!snap) return "";
  let s = `${snap.id}#${snap.viewerShipId}`;
  for (const sh of snap.spacecraft) s += `|${sh.id}:${sh.attachments.join(",")}:${sh.hasRepairDrone ? 1 : 0}${sh.repairUpgraded ? 1 : 0}`;
  return s;
}

function describe(snap: PublicMatchSnapshot | null): ShipDescriptor[] {
  if (!snap) return [];
  const many = snap.spacecraft.length > 1;
  return snap.spacecraft.map((sh, i) => {
    const isViewer = sh.id === snap.viewerShipId;
    return {
      id: sh.id,
      isViewer,
      lane: many ? (isViewer ? 0.42 : -0.42 - (i > 1 ? 0.3 : 0)) : 0,
      attachments: [...sh.attachments],
      hasRepairDrone: sh.hasRepairDrone,
      repairUpgraded: sh.repairUpgraded,
    };
  });
}

/** Renders one Spacecraft per ship; re-renders only when the ship list/attachments change. */
export function Fleet() {
  const sig = useRef<string>(signatureOf(renderBridge.curr));
  const [ships, setShips] = useState<ShipDescriptor[]>(() => describe(renderBridge.curr));
  const pollAcc = useRef(0);

  useFrame((_, dt) => {
    pollAcc.current += dt;
    if (pollAcc.current < 0.2) return;
    pollAcc.current = 0;
    const next = signatureOf(renderBridge.curr);
    if (next !== sig.current) {
      sig.current = next;
      setShips(describe(renderBridge.curr));
    }
  });

  return (
    <>
      {ships.map((s) => (
        <Spacecraft
          key={s.id}
          shipId={s.id}
          color={s.isViewer ? VIEWER_COLOR : OPPONENT_COLOR}
          isViewer={s.isViewer}
          lane={s.lane}
          attachments={s.attachments}
          hasRepairDrone={s.hasRepairDrone}
          repairUpgraded={s.repairUpgraded}
        />
      ))}
      <TractorBeam />
    </>
  );
}

const beamVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const beamFrag = /* glsl */ `
uniform float uTime; uniform float uAlpha;
varying vec2 vUv;
void main(){
  float bands = 0.55 + 0.45 * sin(vUv.y * 60.0 + uTime * 14.0);
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  vec3 c = vec3(1.0, 0.37, 0.82) * bands * (0.4 + edge * 0.6);
  gl_FragColor = vec4(c * uAlpha, 1.0);
}`;

const Y = new Vector3(0, 1, 0);
const dir = new Vector3();
const q = new Quaternion();

/** Pink tractor beam from caster to target while a tractor-lock stun is active. */
function TractorBeam() {
  const mesh = useRef<Mesh>(null);
  const { geo, mat } = useMemo(
    () => ({
      geo: new CylinderGeometry(0.035, 0.035, 1, 10, 1, true),
      mat: new ShaderMaterial({
        vertexShader: beamVert,
        fragmentShader: beamFrag,
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    }),
    [],
  );
  const alpha = useRef(0);
  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const snap = renderBridge.curr;
    let from: Vector3 | null = null;
    let to: Vector3 | null = null;
    if (snap) {
      for (const sh of snap.spacecraft) {
        const eff = sh.effects.find((e) => e.type === "stunned" && e.sourceAbility === "tractor-lock");
        if (!eff) continue;
        const casterShip = snap.players.find((p) => p.id === eff.appliedByPlayerId)?.shipId ?? snap.spacecraft.find((x) => x.id !== sh.id)?.id;
        const a = casterShip ? fxBus.ships.get(casterShip) : undefined;
        const b = fxBus.ships.get(sh.id);
        if (a && b && a.alive && b.alive) {
          from = a.pos;
          to = b.pos;
        }
        break;
      }
    }
    alpha.current += ((from ? 1 : 0) - alpha.current) * (1 - Math.exp(-dt * 6));
    m.visible = alpha.current > 0.01 && from !== null && to !== null;
    if (from && to) {
      dir.subVectors(to, from);
      const len = dir.length();
      m.position.copy(from).addScaledVector(dir, 0.5);
      q.setFromUnitVectors(Y, dir.normalize());
      m.quaternion.copy(q);
      m.scale.set(1, len, 1);
    }
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uAlpha.value = alpha.current * (0.8 + Math.random() * 0.2);
  });
  return <mesh ref={mesh} geometry={geo} material={mat} visible={false} frustumCulled={false} renderOrder={6} />;
}
