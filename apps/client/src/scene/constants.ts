import { CatmullRomCurve3, Vector3 } from "three";
import { ROUTE } from "@sm/shared";
import type { HazardType } from "@sm/shared";

export const VIEWER_COLOR = "#4fc3ff";
export const OPPONENT_COLOR = "#ff6b3d";

/** Direction pointing TO the sun (world space). Light comes from the left/back. */
export const SUN_DIR = new Vector3(-1, 0.6, 0.12).normalize();

/** Scale of the spacecraft model inside the Earth–Moon scene. */
export const SHIP_SCALE = 1.05;

export const HAZARD_COLORS: Record<HazardType, string> = {
  micrometeoroid: "#ffd27a",
  "solar-flare": "#ff9a2e",
  "radiation-belt": "#b46bff",
  "space-debris": "#cfd8e6",
  "thermal-spike": "#ff4d3d",
  "nav-anomaly": "#4d8bff",
};

// ---------------------------------------------------------------------------
// Route geometry (cached once per module).

export const EARTH_POS = new Vector3(...ROUTE.earthPosition);
export const MOON_POS = new Vector3(...ROUTE.moonPosition);
export const EARTH_RADIUS = ROUTE.earthRadius;
export const MOON_RADIUS = ROUTE.moonRadius;

export const ROUTE_CURVE = new CatmullRomCurve3(
  ROUTE.controlPoints.map(([x, y, z]) => new Vector3(x, y, z)),
  false,
  "centripetal",
  0.5,
);
export const ROUTE_LENGTH = ROUTE_CURVE.getLength();

const LUT_N = 1024;
const lutPos = new Float32Array((LUT_N + 1) * 3);
const lutTan = new Float32Array((LUT_N + 1) * 3);
{
  const p = new Vector3();
  const t = new Vector3();
  for (let i = 0; i <= LUT_N; i++) {
    const u = i / LUT_N;
    ROUTE_CURVE.getPointAt(u, p);
    ROUTE_CURVE.getTangentAt(u, t);
    lutPos.set([p.x, p.y, p.z], i * 3);
    lutTan.set([t.x, t.y, t.z], i * 3);
  }
}

/** Fast arc-length-parameterised lookup (frac 0..1) into the cached route samples. */
export function sampleRoute(frac: number, outPos: Vector3, outTan?: Vector3): Vector3 {
  const f = Math.min(1, Math.max(0, frac)) * LUT_N;
  const i = Math.min(LUT_N - 1, Math.floor(f));
  const a = f - i;
  const o0 = i * 3;
  const o1 = o0 + 3;
  outPos.set(
    lutPos[o0] + (lutPos[o1] - lutPos[o0]) * a,
    lutPos[o0 + 1] + (lutPos[o1 + 1] - lutPos[o0 + 1]) * a,
    lutPos[o0 + 2] + (lutPos[o1 + 2] - lutPos[o0 + 2]) * a,
  );
  if (outTan) {
    outTan
      .set(
        lutTan[o0] + (lutTan[o1] - lutTan[o0]) * a,
        lutTan[o0 + 1] + (lutTan[o1 + 1] - lutTan[o0 + 1]) * a,
        lutTan[o0 + 2] + (lutTan[o1 + 2] - lutTan[o0 + 2]) * a,
      )
      .normalize();
  }
  return outPos;
}

const routeEnd = ROUTE_CURVE.getPointAt(1);
export const LUNAR_ORBIT_RADIUS = Math.max(MOON_RADIUS * 1.35, routeEnd.distanceTo(MOON_POS));
export const LUNAR_ORBIT_TILT = 0.18;
export const LUNAR_ORBIT_SPEED = 0.32; // rad/s

const orbitE1 = new Vector3(1, 0, 0);
const orbitE2 = new Vector3(0, Math.sin(LUNAR_ORBIT_TILT), Math.cos(LUNAR_ORBIT_TILT));

/** Point (and tangent) on the parking orbit around the Moon. */
export function lunarOrbitPoint(angle: number, outPos: Vector3, outTan?: Vector3, radius = LUNAR_ORBIT_RADIUS): Vector3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  outPos.copy(MOON_POS).addScaledVector(orbitE1, c * radius).addScaledVector(orbitE2, s * radius);
  if (outTan) outTan.copy(orbitE1).multiplyScalar(-s).addScaledVector(orbitE2, c).normalize();
  return outPos;
}

/** Angle on the orbit plane closest to a world position. */
export function lunarOrbitAngleOf(pos: Vector3): number {
  const dx = pos.x - MOON_POS.x;
  const dy = pos.y - MOON_POS.y;
  const dz = pos.z - MOON_POS.z;
  const a = dx * orbitE1.x + dy * orbitE1.y + dz * orbitE1.z;
  const b = dx * orbitE2.x + dy * orbitE2.y + dz * orbitE2.z;
  return Math.atan2(b, a);
}

export const ORBIT_BASIS = { e1: orbitE1, e2: orbitE2 };
