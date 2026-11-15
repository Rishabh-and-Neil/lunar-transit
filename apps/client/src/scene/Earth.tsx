import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BackSide, type Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { EARTH_POS, EARTH_RADIUS, SUN_DIR } from "./constants";
import { getEarthTextures } from "./textures";

const commonVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const earthFrag = /* glsl */ `
uniform sampler2D uDay; uniform sampler2D uAux; uniform sampler2D uClouds;
uniform vec3 uSun; uniform float uCloudShift;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  vec3 albedo = texture2D(uDay, vUv).rgb;
  vec4 aux = texture2D(uAux, vUv);
  float ocean = aux.r;
  float city = aux.g;
  float cloud = texture2D(uClouds, vUv + vec2(uCloudShift + 0.003, -0.002)).r;

  float lit = smoothstep(-0.08, 0.35, ndl);
  float diff = max(ndl, 0.0);
  vec3 col = albedo * (diff * 1.55 + 0.012) * (1.0 - cloud * 0.5 * lit);

  // ocean sun glint
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 70.0) * ocean * (1.0 - cloud);
  float sheen = pow(max(dot(N, H), 0.0), 8.0) * ocean * 0.08;
  col += (spec * 1.4 + sheen) * vec3(1.0, 0.86, 0.68) * lit;

  // warm terminator band
  float term = smoothstep(-0.18, 0.02, ndl) * (1.0 - smoothstep(0.02, 0.3, ndl));
  col += albedo * term * vec3(0.5, 0.18, 0.04) * 0.6;

  // night city lights
  float night = 1.0 - smoothstep(-0.22, 0.06, ndl);
  col += vec3(1.0, 0.62, 0.28) * pow(city, 1.4) * night * 1.5 * (1.0 - cloud * 0.75);

  // inner atmospheric rim scattering
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
  vec3 atm = mix(vec3(0.95, 0.45, 0.2), vec3(0.32, 0.62, 1.0), smoothstep(-0.05, 0.4, ndl));
  col += atm * fres * smoothstep(-0.35, 0.5, ndl) * 1.1;
  col = mix(col, col * vec3(0.85, 0.92, 1.08) + vec3(0.0, 0.01, 0.03) * lit, 0.5);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const cloudFrag = /* glsl */ `
uniform sampler2D uClouds; uniform vec3 uSun;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  float ndl = dot(N, normalize(uSun));
  float c = texture2D(uClouds, vUv).r;
  float lit = smoothstep(-0.15, 0.4, ndl);
  vec3 col = mix(vec3(0.9, 0.5, 0.35), vec3(1.0), smoothstep(0.0, 0.35, ndl)) * (max(ndl, 0.0) * 1.25 + 0.015);
  float edge = 1.0 - pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.6;
  float a = c * (0.12 + 0.88 * lit) * edge;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const atmoVert = /* glsl */ `
varying vec3 vNView; varying vec3 vPView; varying vec3 vNW;
void main(){
  vNView = normalize(normalMatrix * normal);
  vNW = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const atmoFrag = /* glsl */ `
uniform vec3 uSun; uniform vec3 uColor; uniform float uLimb; uniform float uStrength;
varying vec3 vNView; varying vec3 vPView; varying vec3 vNW;
void main(){
  float d = -dot(normalize(vNView), normalize(-vPView));
  float g = smoothstep(0.0, uLimb, d);
  g = pow(g, 2.2);
  float sun = dot(normalize(vNW), normalize(uSun));
  float lit = smoothstep(-0.45, 0.35, sun);
  vec3 col = mix(vec3(1.0, 0.45, 0.2), uColor, smoothstep(-0.2, 0.3, sun));
  gl_FragColor = vec4(col * g * (0.08 + lit * 1.1) * uStrength, 1.0);
}`;

const ATMO_SCALE = 1.16;

let earthGeo: SphereGeometry | null = null;
function getEarthGeo(): SphereGeometry {
  if (!earthGeo) earthGeo = new SphereGeometry(1, 96, 64);
  return earthGeo;
}

export function Earth() {
  const surface = useRef<Mesh>(null);
  const clouds = useRef<Mesh>(null);
  const { earthMat, cloudMat, atmoMat } = useMemo(() => {
    const t = getEarthTextures();
    const sun = { value: SUN_DIR.clone() };
    const em = new ShaderMaterial({
      vertexShader: commonVert,
      fragmentShader: earthFrag,
      uniforms: { uDay: { value: t.day }, uAux: { value: t.aux }, uClouds: { value: t.clouds }, uSun: sun, uCloudShift: { value: 0 } },
    });
    const cm = new ShaderMaterial({
      vertexShader: commonVert,
      fragmentShader: cloudFrag,
      uniforms: { uClouds: { value: t.clouds }, uSun: sun },
      transparent: true,
      depthWrite: false,
    });
    const am = new ShaderMaterial({
      vertexShader: atmoVert,
      fragmentShader: atmoFrag,
      uniforms: {
        uSun: sun,
        uColor: { value: new Vector3(0.3, 0.62, 1.0) },
        uLimb: { value: Math.sqrt(1 - 1 / (ATMO_SCALE * ATMO_SCALE)) },
        uStrength: { value: 1.0 },
      },
      side: BackSide,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    return { earthMat: em, cloudMat: cm, atmoMat: am };
  }, []);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    if (surface.current && clouds.current) {
      surface.current.rotation.y += d * 0.018;
      clouds.current.rotation.y += d * 0.026;
      earthMat.uniforms.uCloudShift.value = -(clouds.current.rotation.y - surface.current.rotation.y) / (Math.PI * 2);
    }
  });

  const geo = getEarthGeo();
  return (
    <group position={EARTH_POS} rotation={[0, 0, 0.41]}>
      <mesh ref={surface} geometry={geo} material={earthMat} scale={EARTH_RADIUS} rotation={[0, 2.2, 0]} />
      <mesh ref={clouds} geometry={geo} material={cloudMat} scale={EARTH_RADIUS * 1.012} rotation={[0, 2.2, 0]} />
      <mesh geometry={geo} material={atmoMat} scale={EARTH_RADIUS * ATMO_SCALE} />
    </group>
  );
}
