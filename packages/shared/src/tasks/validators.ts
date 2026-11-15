// Task submission validators. Tolerant to float noise; reject malformed input without throwing.
import type {
  CommunicationsPublic, OrbitCalibrationPublic, PowerCalibrationPublic, SurfaceAnalysisPublic,
  TaskInstance, TaskSolution, TaskSubmission, TerrainMappingPublic, ValidationResult,
} from "../types";

const EPS = 1e-6;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const fail = (reason: string): ValidationResult => ({ ok: false, reason });
const OK: ValidationResult = { ok: true };

export function validateSubmission(instance: TaskInstance, submission: TaskSubmission): ValidationResult {
  try {
    if (!isRecord(submission)) return fail("malformed submission");
    const pub = instance.public;
    if (submission.taskId !== pub.taskId) return fail("submission is for a different task");
    switch (pub.taskId) {
      case "surface-analysis":
        return validateSurface(pub, instance.solution, submission);
      case "communications":
        return validateComms(pub, submission);
      case "power-calibration":
        return validatePower(pub, submission);
      case "orbit-calibration":
        return validateOrbit(pub, submission);
      case "terrain-mapping":
        return validateTerrain(pub, instance.solution, submission);
      default:
        return fail("unknown task");
    }
  } catch {
    return fail("malformed submission");
  }
}

function validateSurface(pub: SurfaceAnalysisPublic, solution: TaskSolution, sub: TaskSubmission): ValidationResult {
  if (sub.taskId !== "surface-analysis" || solution.taskId !== "surface-analysis") return fail("malformed submission");
  if (!Array.isArray(sub.regionIds) || !sub.regionIds.every((r) => typeof r === "string")) return fail("malformed submission");
  const known = new Set(pub.regions.map((r) => r.id));
  const chosen = new Set(sub.regionIds);
  for (const id of chosen) if (!known.has(id)) return fail(`unknown region ${id}`);
  const expected = new Set(solution.regionIds);
  const missing = [...expected].filter((id) => !chosen.has(id)).length;
  const wrong = [...chosen].filter((id) => !expected.has(id)).length;
  if (missing === 0 && wrong === 0) return OK;
  if (wrong > 0) return fail(`${wrong} selected region(s) do not meet the criteria`);
  return fail(`${missing} matching region(s) still unselected`);
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

function validateComms(pub: CommunicationsPublic, sub: TaskSubmission): ValidationResult {
  if (sub.taskId !== "communications" || !isFiniteNumber(sub.azimuth) || !isFiniteNumber(sub.elevation)) {
    return fail("malformed submission");
  }
  const dAz = angleDiff(sub.azimuth, pub.earthAzimuth);
  const dEl = Math.abs(sub.elevation - pub.earthElevation);
  if (dAz <= pub.toleranceDeg + EPS && dEl <= pub.toleranceDeg + EPS) return OK;
  return fail(dAz > pub.toleranceDeg ? "azimuth off target — no signal" : "elevation off target — weak signal");
}

function validatePower(pub: PowerCalibrationPublic, sub: TaskSubmission): ValidationResult {
  if (sub.taskId !== "power-calibration" || !isRecord(sub.allocation)) return fail("malformed submission");
  const alloc = sub.allocation;
  const ids = new Set(pub.subsystems.map((s) => s.id));
  for (const key of Object.keys(alloc)) if (!ids.has(key)) return fail(`unknown subsystem ${key}`);
  let total = 0;
  const tol = 0.5;
  for (const s of pub.subsystems) {
    const w = alloc[s.id];
    if (!isFiniteNumber(w)) return fail(`${s.name} has no allocation`);
    if (w < s.minWatts - tol) return fail(`${s.name} is below its minimum`);
    if (w > s.maxWatts + tol) return fail(`${s.name} exceeds its maximum`);
    if (s.critical && Math.abs(w - s.maxWatts) > tol) return fail(`${s.name} is critical and must be at maximum`);
    total += w;
  }
  if (total > pub.availableWatts + tol) return fail("allocation exceeds available power");
  return OK;
}

function validateOrbit(pub: OrbitCalibrationPublic, sub: TaskSubmission): ValidationResult {
  if (sub.taskId !== "orbit-calibration" || !isFiniteNumber(sub.dvAtPeriapsis) || !isFiniteNumber(sub.dvAtApoapsis)) {
    return fail("malformed submission");
  }
  for (const dv of [sub.dvAtPeriapsis, sub.dvAtApoapsis]) {
    if (dv < pub.dvMin - EPS || dv > pub.dvMax + EPS) return fail("burn outside engine limits");
  }
  const apo = pub.currentApoapsisKm + sub.dvAtPeriapsis * pub.kmPerMps;
  const peri = pub.currentPeriapsisKm + sub.dvAtApoapsis * pub.kmPerMps;
  const apoOk = Math.abs(apo - pub.targetApoapsisKm) <= pub.toleranceKm + EPS;
  const periOk = Math.abs(peri - pub.targetPeriapsisKm) <= pub.toleranceKm + EPS;
  if (apoOk && periOk) return OK;
  if (!apoOk) return fail(`apoapsis ends at ${Math.round(apo)} km (target ${pub.targetApoapsisKm} km)`);
  return fail(`periapsis ends at ${Math.round(peri)} km (target ${pub.targetPeriapsisKm} km)`);
}

function validateTerrain(pub: TerrainMappingPublic, solution: TaskSolution, sub: TaskSubmission): ValidationResult {
  if (sub.taskId !== "terrain-mapping" || solution.taskId !== "terrain-mapping" || !isRecord(sub.mapping)) {
    return fail("malformed submission");
  }
  const n = pub.rows * pub.cols;
  const tileById = new Map(pub.tiles.map((t) => [t.id, t]));
  const used = new Set<string>();
  for (const key of Object.keys(sub.mapping)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) return fail("malformed submission");
  }
  let wrong = 0;
  for (let cell = 0; cell < n; cell++) {
    const tileId = (sub.mapping as Record<string, unknown>)[String(cell)];
    if (typeof tileId !== "string") return fail("every cell needs a tile");
    const tile = tileById.get(tileId);
    if (!tile) return fail(`unknown tile ${tileId}`);
    if (used.has(tileId)) return fail(`tile ${tileId} placed twice`);
    used.add(tileId);
    const expected = tileById.get(solution.mapping[cell]);
    if (!expected || expected.kind !== tile.kind || expected.elevation !== tile.elevation) wrong += 1;
  }
  return wrong === 0 ? OK : fail(`${wrong} cell(s) do not match the survey`);
}

/** Convert a stored solution into an equivalent submission (tests, tutorial, debugging). */
export function submissionFromSolution(solution: TaskSolution): TaskSubmission {
  switch (solution.taskId) {
    case "power-calibration":
      return { taskId: "power-calibration", allocation: { ...solution.example } };
    case "surface-analysis":
      return { taskId: "surface-analysis", regionIds: [...solution.regionIds] };
    case "terrain-mapping":
      return { taskId: "terrain-mapping", mapping: { ...solution.mapping } };
    default:
      return { ...solution };
  }
}
