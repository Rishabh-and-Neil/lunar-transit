// Seeded lunar task generators. Every generated instance is solvable by its stored solution.
import { createRng, hashSeed, roundTo, type Rng } from "../rng";
import type {
  CommunicationsPublic, LunarTaskId, OrbitCalibrationPublic, PowerCalibrationPublic, PowerSubsystem,
  SurfaceAnalysisPublic, SurfaceRegion, TaskInstance, TerrainKind, TerrainMappingPublic, TerrainTile,
} from "../types";

/** Generate a task instance. Hint presence never changes the rest of the instance. */
export function generateTask(taskId: LunarTaskId, seed: number, withHint: boolean): TaskInstance {
  const rng = createRng(hashSeed(seed, "task", taskId));
  const inst = GENERATORS[taskId](rng);
  if (!withHint) delete inst.public.hint;
  return inst;
}

const GENERATORS: Record<LunarTaskId, (rng: Rng) => TaskInstance> = {
  "surface-analysis": generateSurfaceAnalysis,
  communications: generateCommunications,
  "power-calibration": generatePowerCalibration,
  "orbit-calibration": generateOrbitCalibration,
  "terrain-mapping": generateTerrainMapping,
};

// ---------------------------------------------------------------------------
// Surface analysis

export const SURFACE_GRID = { rows: 3, cols: 4 } as const;

export function regionId(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

function generateSurfaceAnalysis(rng: Rng): TaskInstance {
  const { rows, cols } = SURFACE_GRID;
  const minTiO2 = rng.pick([5, 6, 7]);
  const minFeO = rng.pick([14, 15, 16]);
  const total = rows * cols;
  const correctCount = rng.int(3, 4);
  const order = rng.shuffle(Array.from({ length: total }, (_, i) => i));
  const correct = new Set(order.slice(0, correctCount));
  // Decoy kinds: near-misses on one criterion, plus clear highlands.
  const decoyKinds: ("low-fe" | "low-ti" | "highland")[] = rng.shuffle([
    "low-fe", "low-fe", "low-ti", "low-ti", "highland", "highland", "highland", "low-ti", "low-fe",
  ]);

  const regions: SurfaceRegion[] = [];
  let decoyIdx = 0;
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    let feO: number;
    let tiO2: number;
    let albedo: number;
    let terrain: SurfaceRegion["terrain"];
    if (correct.has(i)) {
      tiO2 = minTiO2 + rng.range(0.5, 4);
      feO = minFeO + rng.range(0.5, 4);
      albedo = rng.range(0.07, 0.11);
      terrain = "mare";
    } else {
      const kind = decoyKinds[decoyIdx++ % decoyKinds.length];
      if (kind === "low-fe") {
        tiO2 = minTiO2 + rng.range(0.5, 3);
        feO = minFeO - rng.range(1.5, 5);
        albedo = rng.range(0.1, 0.14);
        terrain = rng.pick(["mare", "ejecta"] as const);
      } else if (kind === "low-ti") {
        tiO2 = minTiO2 - rng.range(1.5, 4);
        feO = minFeO + rng.range(0.5, 4);
        albedo = rng.range(0.09, 0.13);
        terrain = rng.pick(["mare", "crater-rim"] as const);
      } else {
        tiO2 = rng.range(0.2, 1.5);
        feO = rng.range(3, 7);
        albedo = rng.range(0.18, 0.3);
        terrain = rng.pick(["highland", "crater-rim", "ejecta"] as const);
      }
    }
    regions.push({
      id: regionId(row, col), row, col,
      feO: roundTo(Math.max(0.1, feO), 1),
      tiO2: roundTo(Math.max(0.1, tiO2), 1),
      albedo: roundTo(albedo, 2),
      terrain,
    });
  }
  const solutionIds = regions.filter((r) => r.tiO2 >= minTiO2 && r.feO >= minFeO).map((r) => r.id);
  const hintRegion = rng.pick(solutionIds);
  const pub: SurfaceAnalysisPublic = {
    taskId: "surface-analysis", rows, cols, regions,
    criterion: `Select every region with TiO2 ≥ ${minTiO2}% AND FeO ≥ ${minFeO}% (high-titanium mare basalt).`,
    minTiO2, minFeO,
    hint: `Spectrometer lock: region ${hintRegion} is a confirmed high-titanium basalt. Dark, low-albedo mare regions are the best candidates — but check both oxides.`,
  };
  return { public: pub, solution: { taskId: "surface-analysis", regionIds: solutionIds } };
}

// ---------------------------------------------------------------------------
// Communications

interface LunarSite { name: string; az: number; el: number; polar: boolean }

/** Approximate Earth position in the sky from real landing sites (game values, jittered for libration). */
export const LUNAR_SITES: LunarSite[] = [
  { name: "Mare Tranquillitatis (Apollo 11)", az: 268, el: 66, polar: false },
  { name: "Oceanus Procellarum (Apollo 12)", az: 85, el: 66, polar: false },
  { name: "Hadley Rille (Apollo 15)", az: 188, el: 63, polar: false },
  { name: "Taurus-Littrow Valley (Apollo 17)", az: 236, el: 54, polar: false },
  { name: "Fra Mauro Highlands (Apollo 14)", az: 95, el: 72, polar: false },
  { name: "Shackleton Crater rim", az: 0, el: 6, polar: true },
  { name: "Malapert Massif", az: 0, el: 8, polar: true },
  { name: "Nobile Crater rim", az: 0, el: 5, polar: true },
];

function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

function generateCommunications(rng: Rng): TaskInstance {
  const site = rng.pick(LUNAR_SITES);
  let az: number;
  let el: number;
  if (site.polar) {
    az = wrap360(rng.range(0, 360));
    el = rng.range(2, 12);
  } else {
    az = wrap360(site.az + rng.range(-5, 5));
    el = Math.min(85, site.el + rng.range(-5, 5));
  }
  az = roundTo(az, 1);
  el = roundTo(el, 1);
  const startAzimuth = roundTo(wrap360(az + rng.range(120, 240)), 0);
  const startElevation = site.polar ? roundTo(rng.range(45, 80), 0) : roundTo(rng.range(5, 25), 0);
  const pub: CommunicationsPublic = {
    taskId: "communications",
    earthAzimuth: az, earthElevation: el, toleranceDeg: 6,
    startAzimuth, startElevation, siteName: site.name,
    hint: site.polar
      ? `From near the south pole Earth barely clears the horizon — about ${Math.round(el)}° up. Keep the dish low.`
      : `From this near-side site Earth stays high in the sky, roughly ${Math.round(el)}° above the horizon at azimuth ~${Math.round(az)}°.`,
  };
  return { public: pub, solution: { taskId: "communications", azimuth: az, elevation: el } };
}

// ---------------------------------------------------------------------------
// Power calibration

export const POWER_SUBSYSTEM_NAMES = [
  "Thermal Control", "Communications", "Science Payload", "Guidance & Navigation",
  "Command & Data Handling", "Attitude Control", "Sample Drill", "Surface Camera",
];

function generatePowerCalibration(rng: Rng): TaskInstance {
  const step = 5;
  const count = rng.int(4, 6);
  const names = rng.shuffle(POWER_SUBSYSTEM_NAMES).slice(0, count);
  const criticalCount = rng.int(1, 2);
  const subsystems: PowerSubsystem[] = names.map((name, i) => {
    const minWatts = rng.int(2, 8) * step; // 10..40
    const maxWatts = minWatts + rng.int(2, 8) * step; // +10..+40
    return {
      id: `sub-${i + 1}`, name, minWatts, maxWatts, critical: i < criticalCount,
    };
  });
  const ordered = rng.shuffle(subsystems);
  const flexible = ordered.filter((s) => !s.critical);
  const required = ordered.reduce((s, x) => s + (x.critical ? x.maxWatts : x.minWatts), 0);
  const flexRange = flexible.reduce((s, x) => s + (x.maxWatts - x.minWatts), 0);
  // Slack between 20% and 60% of what flexible systems could absorb: maxing everything never fits.
  const slackSteps = Math.max(1, Math.floor((flexRange * rng.range(0.2, 0.6)) / step));
  const slack = Math.min(flexRange - step, slackSteps * step);
  const availableWatts = required + Math.max(0, slack);

  // Example allocation: critical at max, flexible at min, then distribute slack.
  const example: Record<string, number> = {};
  for (const s of ordered) example[s.id] = s.critical ? s.maxWatts : s.minWatts;
  let remaining = availableWatts - required;
  for (const s of flexible) {
    const add = Math.min(remaining, s.maxWatts - s.minWatts);
    example[s.id] += add;
    remaining -= add;
  }
  const pub: PowerCalibrationPublic = {
    taskId: "power-calibration", availableWatts, subsystems: ordered, step,
    hint: `Critical systems need exactly their maximum (${ordered.filter((s) => s.critical).map((s) => s.name).join(", ")}). Give everything else its minimum first, then share the ${availableWatts - required} W left over.`,
  };
  return { public: pub, solution: { taskId: "power-calibration", example } };
}

// ---------------------------------------------------------------------------
// Orbit calibration

function generateOrbitCalibration(rng: Rng): TaskInstance {
  const kmPerMps = 4;
  const dvMin = -60;
  const dvMax = 60;
  const nonZeroDv = (): number => rng.pick([-1, 1]) * rng.int(2, 10) * 5; // ±10..±50
  for (;;) {
    const currentPeriapsisKm = rng.int(8, 20) * 10; // 80..200
    const currentApoapsisKm = rng.int(30, 90) * 10; // 300..900
    const dvAtPeriapsis = nonZeroDv();
    const dvAtApoapsis = nonZeroDv();
    const targetApoapsisKm = currentApoapsisKm + dvAtPeriapsis * kmPerMps;
    const targetPeriapsisKm = currentPeriapsisKm + dvAtApoapsis * kmPerMps;
    if (targetPeriapsisKm < 30 || targetApoapsisKm < targetPeriapsisKm + 80) continue;
    const pub: OrbitCalibrationPublic = {
      taskId: "orbit-calibration",
      currentPeriapsisKm, currentApoapsisKm, targetPeriapsisKm, targetApoapsisKm,
      toleranceKm: 15, dvMin, dvMax, kmPerMps,
      hint: `Δ altitude = Δv × ${kmPerMps} km per m/s. The periapsis burn must ${dvAtPeriapsis > 0 ? "raise" : "lower"} apoapsis; the apoapsis burn must ${dvAtApoapsis > 0 ? "raise" : "lower"} periapsis.`,
    };
    return { public: pub, solution: { taskId: "orbit-calibration", dvAtPeriapsis, dvAtApoapsis } };
  }
}

// ---------------------------------------------------------------------------
// Terrain mapping

export const TERRAIN_GRID = { rows: 3, cols: 3 } as const;

const KINDS_BY_ELEVATION: TerrainKind[][] = [
  ["crater", "rille", "mare"],
  ["mare", "crater", "landing-site"],
  ["landing-site", "ridge", "mare"],
  ["highland", "ridge"],
  ["highland", "ridge"],
];

function kindLabel(kind: TerrainKind): string {
  return kind === "landing-site" ? "landing site" : kind;
}

function generateTerrainMapping(rng: Rng): TaskInstance {
  const { rows, cols } = TERRAIN_GRID;
  const n = rows * cols;
  // Four elevation levels get 2 cells, one level gets 1 cell.
  const levels = rng.shuffle([0, 1, 2, 3, 4]);
  const multiset: number[] = [];
  levels.forEach((lvl, i) => {
    multiset.push(lvl);
    if (i < 4) multiset.push(lvl);
  });
  const cellElevations = rng.shuffle(multiset);

  // Group cells by elevation.
  const groups = new Map<number, number[]>();
  cellElevations.forEach((e, cell) => {
    const g = groups.get(e) ?? [];
    g.push(cell);
    groups.set(e, g);
  });
  const pairLevels = rng.shuffle([...groups.entries()].filter(([, cells]) => cells.length === 2).map(([e]) => e));
  // 2 pairs disambiguated by anchors, 1-2 by clues, the rest share a kind.
  const clueCount = rng.int(1, 2);
  const anchorLevels = new Set(pairLevels.slice(0, 2));
  const clueLevels = new Set(pairLevels.slice(2, 2 + clueCount));

  const cellKinds: TerrainKind[] = new Array<TerrainKind>(n);
  for (const [e, cells] of groups) {
    const options = rng.shuffle(KINDS_BY_ELEVATION[e]);
    if (cells.length === 2 && (anchorLevels.has(e) || clueLevels.has(e))) {
      cellKinds[cells[0]] = options[0];
      cellKinds[cells[1]] = options[1];
    } else {
      for (const c of cells) cellKinds[c] = options[0];
    }
  }

  // Tiles in shuffled order with ids T1..T9.
  const cellOrder = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const tiles: TerrainTile[] = [];
  const mapping: Record<number, string> = {};
  cellOrder.forEach((cell, i) => {
    const id = `T${i + 1}`;
    tiles.push({ id, kind: cellKinds[cell], elevation: cellElevations[cell] });
    mapping[cell] = id;
  });

  const anchors: Record<number, string> = {};
  for (const e of anchorLevels) {
    const cells = groups.get(e) ?? [];
    const cell = rng.pick(cells);
    anchors[cell] = mapping[cell];
  }

  const clues: string[] = [];
  const clueCells: number[] = [];
  for (const e of clueLevels) {
    const [a, b] = groups.get(e) ?? [];
    if (a === undefined || b === undefined) continue;
    const ra = Math.floor(a / cols), ca = a % cols;
    const rb = Math.floor(b / cols), cb = b % cols;
    let dir: string;
    if (ca !== cb) dir = ca < cb ? "west" : "east";
    else dir = ra < rb ? "north" : "south";
    clues.push(`At elevation band ${e}, the ${kindLabel(cellKinds[a])} lies ${dir} of the ${kindLabel(cellKinds[b])}.`);
    clueCells.push(a);
  }

  const hintCell = clueCells.length > 0 ? rng.pick(clueCells) : rng.int(0, n - 1);
  const pub: TerrainMappingPublic = {
    taskId: "terrain-mapping", rows, cols, cellElevations, anchors, tiles, clues,
    hint: `Altimetry cross-check: the cell in row ${Math.floor(hintCell / cols) + 1}, column ${(hintCell % cols) + 1} is a ${kindLabel(cellKinds[hintCell])}. Start by matching each tile's elevation band to the map.`,
  };
  return { public: pub, solution: { taskId: "terrain-mapping", mapping } };
}
