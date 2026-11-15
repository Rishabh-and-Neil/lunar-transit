import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  type Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { LUNAR_ORBIT_RADIUS, MOON_POS, MOON_RADIUS, ORBIT_BASIS, SUN_DIR } from "./constants";
import { getMoonTextures } from "./textures";

const haloVert = /* glsl */ `
varying vec3 vNView; varying vec3 vPView; varying vec3 vNW;
void main(){
  vNView = normalize(normalMatrix * normal);
  vNW = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const haloFrag = /* glsl */ `
uniform vec3 uSun; uniform float uLimb;
varying vec3 vNView; varying vec3 vPView; varying vec3 vNW;
void main(){
  float d = -dot(normalize(vNView), normalize(-vPView));
  float g = pow(smoothstep(0.0, uLimb, d), 3.0);
  float lit = smoothstep(-0.3, 0.5, dot(normalize(vNW), normalize(uSun)));
  gl_FragColor = vec4(vec3(0.75, 0.8, 0.9) * g * (0.03 + lit * 0.22), 1.0);
}`;

const ringVert = /* glsl */ `
attribute float aT;
varying float vT;
void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const ringFrag = /* glsl */ `
uniform float uTime; uniform float uOpacity;
varying float vT;
void main(){
  float dash = smoothstep(0.3, 0.5, fract(vT * 48.0 - uTime * 0.25)) * (1.0 - smoothstep(0.5, 0.7, fract(vT * 48.0 - uTime * 0.25)));
  gl_FragColor = vec4(vec3(0.55, 0.8, 1.0) * (0.25 + dash * 0.75) * uOpacity, 1.0);
}`;

export function Moon({ orbitOpacity = 0.5 }: { orbitOpacity?: number }) {
  const body = useRef<Mesh>(null);
  const { geo, mat, haloMat, ringGeo, ringMat } = useMemo(() => {
    const t = getMoonTextures();
    const g = new SphereGeometry(1, 96, 64);
    const m = new MeshStandardMaterial({
      map: t.albedo,
      bumpMap: t.bump,
      bumpScale: 2.2,
      roughness: 0.96,
      metalness: 0,
    });
    const HALO = 1.08;
    const hm = new ShaderMaterial({
      vertexShader: haloVert,
      fragmentShader: haloFrag,
      uniforms: { uSun: { value: SUN_DIR.clone() }, uLimb: { value: Math.sqrt(1 - 1 / (HALO * HALO)) } },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    // Parking orbit ring (line loop with a parametric attribute for animated dashes).
    const N = 256;
    const pos = new Float32Array((N + 1) * 3);
    const tt = new Float32Array(N + 1);
    const p = new Vector3();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      p.set(0, 0, 0).addScaledVector(ORBIT_BASIS.e1, Math.cos(a) * LUNAR_ORBIT_RADIUS).addScaledVector(ORBIT_BASIS.e2, Math.sin(a) * LUNAR_ORBIT_RADIUS);
      pos.set([p.x, p.y, p.z], i * 3);
      tt[i] = i / N;
    }
    const rg = new BufferGeometry();
    rg.setAttribute("position", new BufferAttribute(pos, 3));
    rg.setAttribute("aT", new BufferAttribute(tt, 1));
    const rm = new ShaderMaterial({
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.5 } },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    return { geo: g, mat: m, haloMat: hm, ringGeo: rg, ringMat: rm, HALO };
  }, []);

  useFrame((state, dt) => {
    if (body.current) body.current.rotation.y += Math.min(dt, 0.1) * 0.012;
    ringMat.uniforms.uTime.value = state.clock.elapsedTime;
    ringMat.uniforms.uOpacity.value = orbitOpacity;
  });

  return (
    <group position={MOON_POS}>
      <mesh ref={body} geometry={geo} material={mat} scale={MOON_RADIUS} rotation={[0.1, 3.4, 0.05]} />
      <mesh geometry={geo} material={haloMat} scale={MOON_RADIUS * 1.08} />
      <lineLoop geometry={ringGeo} material={ringMat} />
    </group>
  );
}
