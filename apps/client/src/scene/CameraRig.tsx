import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, MathUtils, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from "three";
import { renderBridge } from "../state/renderBridge";
import {
  EARTH_POS,
  EARTH_RADIUS,
  LUNAR_ORBIT_RADIUS,
  MOON_POS,
  SUN_DIR,
  sampleRoute,
} from "./constants";
import { fxBus } from "./fxBus";

export type SceneVariant = "menu" | "flight" | "arrival";

const UP = new Vector3(0, 1, 0);

function boundsPoints(includeRoute: boolean, center: Vector3, radius: number): Vector3[] {
  const pts: Vector3[] = [];
  const add = (c: Vector3, r: number) => {
    pts.push(
      c.clone().add(new Vector3(r, 0, 0)),
      c.clone().add(new Vector3(-r, 0, 0)),
      c.clone().add(new Vector3(0, r, 0)),
      c.clone().add(new Vector3(0, -r, 0)),
      c.clone().add(new Vector3(0, 0, r)),
      c.clone().add(new Vector3(0, 0, -r)),
    );
  };
  if (includeRoute) {
    add(EARTH_POS, EARTH_RADIUS * 1.15);
    add(MOON_POS, LUNAR_ORBIT_RADIUS * 1.1);
    const p = new Vector3();
    for (let i = 0; i <= 24; i++) {
      sampleRoute(i / 24, p);
      pts.push(p.clone().add(new Vector3(0, 0.5, 0)), p.clone().add(new Vector3(0, -0.3, 0)));
    }
  } else {
    add(center, radius);
  }
  return pts;
}

interface Frame {
  target: Vector3;
  dist: number;
}

/** Find the camera distance (and re-centred target) that fits `pts` inside the viewport. */
function fitFrame(pts: Vector3[], dir: Vector3, fovDeg: number, aspect: number, margin: number): Frame {
  const tanV = Math.tan(MathUtils.degToRad(fovDeg) / 2) * margin;
  const tanH = tanV * aspect;
  const f = dir.clone().negate();
  const r = new Vector3().crossVectors(f, UP).normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  const target = new Vector3();
  for (const p of pts) target.add(p);
  target.divideScalar(pts.length);
  const cam = new Vector3();
  const rel = new Vector3();

  const fits = (d: number): boolean => {
    cam.copy(target).addScaledVector(dir, d);
    for (const p of pts) {
      rel.subVectors(p, cam);
      const z = rel.dot(f);
      if (z < 0.2) return false;
      if (Math.abs(rel.dot(r) / z) > tanH || Math.abs(rel.dot(u) / z) > tanV) return false;
    }
    return true;
  };
  const search = (): number => {
    let lo = 1;
    let hi = 600;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let d = search();
  for (let it = 0; it < 4; it++) {
    cam.copy(target).addScaledVector(dir, d);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      rel.subVectors(p, cam);
      const z = rel.dot(f);
      const x = rel.dot(r) / z / tanH;
      const y = rel.dot(u) / z / tanV;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    target.addScaledVector(r, cx * tanH * d).addScaledVector(u, cy * tanV * d);
    d = search();
  }
  return { target, dist: d };
}

function viewDir(aspect: number, extraAz = 0, extraEl = 0): Vector3 {
  // Landscape: classic angled side view from +Z. Portrait: chase view from behind Earth.
  const t = MathUtils.smoothstep(aspect, 0.62, 1.15);
  const az = MathUtils.lerp(-Math.PI / 2 + 0.18, 0, t) + extraAz;
  const el = MathUtils.lerp(MathUtils.degToRad(58), MathUtils.degToRad(60), t) + extraEl;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

const overlayVert = /* glsl */ `
varying vec2 vNdc;
void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const overlayFrag = /* glsl */ `
uniform vec2 uSun; uniform float uSunI; uniform float uAspect; uniform vec3 uFlashColor; uniform float uFlash;
varying vec2 vNdc;
void main(){
  vec2 p = vec2(vNdc.x * uAspect, vNdc.y);
  vec2 s = vec2(uSun.x * uAspect, uSun.y);
  float d = length(p - s);
  vec3 col = vec3(1.0, 0.76, 0.52) * exp(-d * 1.15) * 0.2 * uSunI;
  col += vec3(1.0, 0.92, 0.8) * exp(-d * 3.5) * 0.18 * uSunI;
  float near = 1.0 - smoothstep(1.2, 2.6, length(uSun));
  for (int i = 0; i < 3; i++) {
    float k = -0.25 - float(i) * 0.5;
    vec2 gp = s * k;
    float gd = length(p - gp);
    vec3 gc = i == 1 ? vec3(0.35, 0.7, 1.0) : vec3(1.0, 0.6, 0.35);
    col += gc * (smoothstep(0.09 + float(i) * 0.04, 0.0, gd) * 0.035) * uSunI * near;
  }
  float vig = smoothstep(0.25, 1.5, length(vNdc));
  col += uFlashColor * uFlash * (0.18 + vig * 0.9) * 0.65;
  gl_FragColor = vec4(col, 1.0);
}`;

const tmpSun = new Vector3();
const desiredPos = new Vector3();
const desiredTarget = new Vector3();
const shipPos = new Vector3();

/** Camera framing (2.5D angled top-down) + screen-space glare / hit flash overlay. */
export function CameraRig({ variant }: { variant: SceneVariant }) {
  const { camera, size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  const fov = camera instanceof PerspectiveCamera ? camera.fov : 38;

  const frames = useMemo(() => {
    const dir = viewDir(aspect);
    const portrait = aspect < 0.9;
    const full = fitFrame(boundsPoints(true, MOON_POS, 0), dir, fov, aspect, portrait ? 0.86 : 0.9);
    const moon = fitFrame(boundsPoints(false, MOON_POS, LUNAR_ORBIT_RADIUS * 1.45), dir, fov, aspect, 0.8);
    moon.target.copy(MOON_POS);
    return { dir, full, moon, portrait };
  }, [aspect, fov]);

  const overlay = useMemo(() => {
    const geo = new PlaneGeometry(2, 2);
    const mat = new ShaderMaterial({
      vertexShader: overlayVert,
      fragmentShader: overlayFrag,
      uniforms: {
        uSun: { value: new Vector2(-2, 1) },
        uSunI: { value: 0 },
        uAspect: { value: 1 },
        uFlashColor: { value: fxBus.flashColor },
        uFlash: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    return { geo, mat };
  }, []);

  const st = useRef({ init: false, pos: new Vector3(), look: new Vector3(), startedAt: 0 });

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const s = st.current;
    const { dir, full, moon, portrait } = frames;

    let lambda = 2;
    if (variant === "menu") {
      const d = viewDir(aspect, Math.sin(t * 0.05) * 0.14, Math.sin(t * 0.037) * 0.05);
      const dist = full.dist * (0.97 + Math.sin(t * 0.043) * 0.025);
      desiredTarget.copy(full.target);
      desiredPos.copy(desiredTarget).addScaledVector(d, dist);
      lambda = 0.9;
    } else if (variant === "arrival") {
      const d = viewDir(aspect, Math.sin(t * 0.08) * 0.25 + 0.15, 0.08);
      desiredTarget.copy(moon.target);
      desiredPos.copy(desiredTarget).addScaledVector(d, moon.dist);
      lambda = 0.9;
    } else {
      desiredTarget.copy(full.target);
      const vid = renderBridge.curr?.viewerShipId;
      const live = vid ? fxBus.ships.get(vid) : undefined;
      if (live) {
        shipPos.copy(live.pos);
        shipPos.y = full.target.y;
        desiredTarget.lerp(shipPos, portrait ? 0.22 : 0.12);
      }
      desiredPos.copy(desiredTarget).addScaledVector(dir, full.dist * (portrait ? 0.84 : 0.93));
      lambda = 1.6;
    }

    if (!s.init) {
      s.init = true;
      s.startedAt = t;
      s.look.copy(desiredTarget);
      if (variant === "menu") s.pos.copy(desiredTarget).addScaledVector(dir, full.dist * 1.45);
      else if (variant === "arrival") s.pos.copy(full.target).addScaledVector(dir, full.dist);
      else s.pos.copy(desiredPos);
      if (variant === "arrival") s.look.copy(full.target);
    }
    s.pos.x = MathUtils.damp(s.pos.x, desiredPos.x, lambda, dt);
    s.pos.y = MathUtils.damp(s.pos.y, desiredPos.y, lambda, dt);
    s.pos.z = MathUtils.damp(s.pos.z, desiredPos.z, lambda, dt);
    s.look.x = MathUtils.damp(s.look.x, desiredTarget.x, lambda * 1.2, dt);
    s.look.y = MathUtils.damp(s.look.y, desiredTarget.y, lambda * 1.2, dt);
    s.look.z = MathUtils.damp(s.look.z, desiredTarget.z, lambda * 1.2, dt);

    camera.position.copy(s.pos);
    // camera shake
    fxBus.shake *= Math.exp(-dt * 3.2);
    if (fxBus.shake > 0.001) {
      const amp = fxBus.shake * 0.012 * s.pos.distanceTo(s.look);
      camera.position.x += Math.sin(t * 47.3) * amp;
      camera.position.y += Math.sin(t * 53.1 + 1.3) * amp;
      camera.position.z += Math.sin(t * 41.7 + 2.1) * amp;
    }
    camera.up.copy(UP);
    camera.lookAt(s.look);
    camera.updateMatrixWorld();

    // overlay: sun glare position in NDC-ish space + flash
    const u = overlay.mat.uniforms;
    tmpSun.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
    const tanV = Math.tan(MathUtils.degToRad(fov) / 2);
    const tanH = tanV * aspect;
    const sunVec = u.uSun.value as Vector2;
    if (tmpSun.z < -0.05) sunVec.set(tmpSun.x / -tmpSun.z / tanH, tmpSun.y / -tmpSun.z / tanV);
    else sunVec.set(tmpSun.x, tmpSun.y).normalize().multiplyScalar(2.6);
    if (sunVec.length() > 3) sunVec.setLength(3);
    u.uSunI.value = MathUtils.smoothstep(-tmpSun.z, -0.6, 0.6) * 0.9 + 0.15;
    u.uAspect.value = aspect;
    fxBus.flash *= Math.exp(-dt * 2.6);
    u.uFlash.value = fxBus.flash;
  });

  return <mesh geometry={overlay.geo} material={overlay.mat} frustumCulled={false} renderOrder={1000} />;
}
