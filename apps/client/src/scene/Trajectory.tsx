import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, Vector3 } from "three";
import { ROUTE } from "@sm/shared";
import { renderBridge } from "../state/renderBridge";
import { ROUTE_LENGTH, VIEWER_COLOR, sampleRoute } from "./constants";
import { fxBus } from "./fxBus";

const SEGMENTS = 900;
const TICK_SPACING_UNITS = 25;

let cachedGeo: BufferGeometry | null = null;
/** Camera-facing ribbon along the cached route samples. */
function getRibbonGeometry(): BufferGeometry {
  if (cachedGeo) return cachedGeo;
  const n = SEGMENTS + 1;
  const pos = new Float32Array(n * 2 * 3);
  const tan = new Float32Array(n * 2 * 3);
  const side = new Float32Array(n * 2);
  const along = new Float32Array(n * 2);
  const p = new Vector3();
  const t = new Vector3();
  for (let i = 0; i < n; i++) {
    const u = i / SEGMENTS;
    sampleRoute(u, p, t);
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos.set([p.x, p.y, p.z], k * 3);
      tan.set([t.x, t.y, t.z], k * 3);
      side[k] = s === 0 ? -1 : 1;
      along[k] = u;
    }
  }
  const idx = new Uint32Array(SEGMENTS * 6);
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aTangent", new BufferAttribute(tan, 3));
  g.setAttribute("aSide", new BufferAttribute(side, 1));
  g.setAttribute("aAlong", new BufferAttribute(along, 1));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  cachedGeo = g;
  return g;
}

const vert = /* glsl */ `
attribute vec3 aTangent; attribute float aSide; attribute float aAlong;
uniform float uWidth; uniform float uMinAngular;
varying float vSide; varying float vAlong;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 tv = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz);
  vec3 toCam = normalize(-mv.xyz);
  vec3 off = normalize(cross(tv, toCam));
  float w = max(uWidth, -mv.z * uMinAngular);
  mv.xyz += off * aSide * w;
  vSide = aSide; vAlong = aAlong;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float uTime; uniform float uProgress; uniform float uOpacity; uniform float uLen;
uniform float uTicks; uniform float uDashes; uniform vec3 uColor; uniform vec3 uDone; uniform float uHasShip;
varying float vSide; varying float vAlong;
void main(){
  float s2 = vSide * vSide;
  float core = exp(-s2 * 55.0);
  float halo = exp(-s2 * 5.0);
  float done = 1.0 - smoothstep(uProgress - 0.0015, uProgress + 0.0015, vAlong);
  done *= uHasShip;

  // animated dashes flowing toward the Moon
  float ph = fract(vAlong * uDashes - uTime * 0.35);
  float dash = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.45, 0.53, ph));

  // ticks every 25 route units
  float tPos = vAlong * uTicks;
  float tDist = abs(fract(tPos + 0.5) - 0.5) / uTicks * uLen; // world distance to nearest tick
  float tick = (1.0 - smoothstep(0.03, 0.07, tDist)) * step(0.02, vAlong) * step(vAlong, 0.98);
  tick *= smoothstep(1.0, 0.55, abs(vSide));

  float ends = smoothstep(0.0, 0.02, vAlong) * (1.0 - smoothstep(0.985, 1.0, vAlong) * 0.6);

  vec3 ahead = uColor * (core * (0.18 + dash * 0.75) + halo * 0.09);
  vec3 behind = uDone * (core * 1.25 + halo * 0.38);
  vec3 col = mix(ahead, behind, done);
  col += mix(uColor, uDone, done) * tick * 0.9;

  // pulse travelling at the ship's position
  float head = exp(-pow((vAlong - uProgress) * 140.0, 2.0)) * uHasShip;
  col += uDone * head * (halo * 1.2 + core * 2.0);

  gl_FragColor = vec4(col * uOpacity * ends, 1.0);
}`;

export function Trajectory({ opacity = 1, followViewer = true }: { opacity?: number; followViewer?: boolean }) {
  const { geo, mat } = useMemo(() => {
    const m = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uOpacity: { value: opacity },
        uLen: { value: ROUTE_LENGTH },
        uTicks: { value: ROUTE.distanceUnits / TICK_SPACING_UNITS },
        uDashes: { value: Math.round(ROUTE_LENGTH * 2.2) },
        uColor: { value: new Color("#8fb6ff") },
        uDone: { value: new Color(VIEWER_COLOR) },
        uHasShip: { value: 0 },
        uWidth: { value: 0.32 },
        uMinAngular: { value: 0.006 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { geo: getRibbonGeometry(), mat: m };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, dt) => {
    const u = mat.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uOpacity.value += (opacity - u.uOpacity.value) * (1 - Math.exp(-dt * 3));
    const vid = renderBridge.curr?.viewerShipId;
    const live = vid ? fxBus.ships.get(vid) : undefined;
    if (followViewer && live && live.alive) {
      u.uProgress.value = live.frac;
      u.uHasShip.value = Math.min(1, u.uHasShip.value + dt * 2);
    } else {
      u.uHasShip.value = Math.max(0, u.uHasShip.value - dt * 2);
    }
  });

  return <mesh geometry={geo} material={mat} renderOrder={2} frustumCulled={false} />;
}
