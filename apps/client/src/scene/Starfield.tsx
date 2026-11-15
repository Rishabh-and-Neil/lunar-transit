import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  type Group,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  SpriteMaterial,
} from "three";
import { mulberry32 } from "./noise";
import { getFlareTexture, getGlowTexture, getSkyTexture } from "./textures";
import { SUN_DIR } from "./constants";

const STAR_RADIUS = 600;
const SKY_RADIUS = 1200;

function buildStars(count: number): BufferGeometry {
  const rnd = mulberry32(777);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const gx = 0.28, gy = 0.86, gz = 0.42;
  const gl = Math.hypot(gx, gy, gz);
  const palette = [
    new Color("#9fc4ff"),
    new Color("#cfe0ff"),
    new Color("#ffffff"),
    new Color("#fff1d6"),
    new Color("#ffd6a1"),
    new Color("#ffb38a"),
  ];
  let i = 0;
  while (i < count) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const x = s * Math.cos(th);
    const y = u;
    const z = s * Math.sin(th);
    // Concentrate ~45% of stars along the galactic band.
    const band = Math.abs((x * gx + y * gy + z * gz) / gl);
    if (rnd() < 0.45 && band > 0.18 * rnd() + 0.05) continue;
    pos[i * 3] = x * STAR_RADIUS;
    pos[i * 3 + 1] = y * STAR_RADIUS;
    pos[i * 3 + 2] = z * STAR_RADIUS;
    const c = palette[Math.min(palette.length - 1, Math.floor(Math.pow(rnd(), 1.3) * palette.length))];
    const b = 0.55 + rnd() * 0.45;
    col[i * 3] = c.r * b;
    col[i * 3 + 1] = c.g * b;
    col[i * 3 + 2] = c.b * b;
    size[i] = 0.9 + Math.pow(rnd(), 9) * 4.2 + rnd() * 0.8;
    phase[i] = rnd();
    i++;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aColor", new BufferAttribute(col, 3));
  g.setAttribute("aSize", new BufferAttribute(size, 1));
  g.setAttribute("aPhase", new BufferAttribute(phase, 1));
  return g;
}

const starVert = /* glsl */ `
attribute vec3 aColor; attribute float aSize; attribute float aPhase;
uniform float uTime; uniform float uPixelRatio;
varying vec3 vColor; varying float vTw; varying float vSize;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.72 + 0.28 * sin(uTime * (0.6 + aPhase * 2.4) + aPhase * 60.0);
  vTw = tw; vColor = aColor; vSize = aSize;
  gl_PointSize = aSize * uPixelRatio * (aSize > 2.5 ? 2.6 : 1.6);
}`;
const starFrag = /* glsl */ `
varying vec3 vColor; varying float vTw; varying float vSize;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = exp(-d * d * (vSize > 2.5 ? 90.0 : 30.0));
  float spikes = 0.0;
  if (vSize > 2.5) {
    spikes = max(0.0, 1.0 - abs(c.x) * 26.0) * max(0.0, 1.0 - abs(c.y) * 2.1)
           + max(0.0, 1.0 - abs(c.y) * 26.0) * max(0.0, 1.0 - abs(c.x) * 2.1);
    spikes *= 0.55;
  }
  float a = (core + spikes) * vTw;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

/** Background: nebula sky sphere, twinkling stars and the Sun. Follows the camera (infinitely far). */
export function Starfield() {
  const group = useRef<Group>(null);
  const { camera, gl } = useThree();

  const { skyGeo, skyMat, starGeo, starMat, sunCore, sunHalo } = useMemo(() => {
    const sg = new SphereGeometry(SKY_RADIUS, 48, 24);
    const sm = new MeshBasicMaterial({ map: getSkyTexture(), side: BackSide, depthWrite: false, toneMapped: false });
    const stg = buildStars(5200);
    const stm = new ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const core = new SpriteMaterial({
      map: getFlareTexture(),
      color: new Color("#fff4e0"),
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    const halo = new SpriteMaterial({
      map: getGlowTexture(),
      color: new Color("#ffb070"),
      opacity: 0.35,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    return { skyGeo: sg, skyMat: sm, starGeo: stg, starMat: stm, sunCore: core, sunHalo: halo };
  }, []);

  useFrame((state) => {
    if (group.current) group.current.position.copy(camera.position);
    starMat.uniforms.uTime.value = state.clock.elapsedTime;
    starMat.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  const sunPos: [number, number, number] = [SUN_DIR.x * 900, SUN_DIR.y * 900, SUN_DIR.z * 900];

  return (
    <group ref={group}>
      <mesh geometry={skyGeo} material={skyMat} renderOrder={-10} frustumCulled={false} rotation={[0.3, 0.8, 0.1]} />
      <points geometry={starGeo} material={starMat} renderOrder={-9} frustumCulled={false} />
      <sprite material={sunHalo} position={sunPos} scale={[420, 420, 1]} renderOrder={-8} />
      <sprite material={sunCore} position={sunPos} scale={[160, 160, 1]} renderOrder={-8} />
    </group>
  );
}
