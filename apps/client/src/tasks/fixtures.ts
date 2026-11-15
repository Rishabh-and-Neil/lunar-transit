// DEV-ONLY sample task instances so the minigame UIs can be previewed without the engine.
// All numbers are invented sample data, not NASA measurements.
import type {
  CommunicationsPublic,
  LunarTaskId,
  OrbitCalibrationPublic,
  PowerCalibrationPublic,
  PublicTaskInstance,
  SurfaceAnalysisPublic,
  SurfaceRegion,
  TerrainMappingPublic,
} from "@sm/shared";

const surfaceTerrain: SurfaceRegion["terrain"][] = [
  "highland", "highland", "crater-rim", "mare", "mare",
  "highland", "ejecta", "mare", "mare", "mare",
  "crater-rim", "highland", "ejecta", "mare", "highland",
  "highland", "highland", "mare", "ejecta", "crater-rim",
];
const surfaceFeO = [5.1, 4.6, 7.9, 17.8, 19.2, 4.2, 9.4, 18.6, 16.1, 20.3, 8.2, 5.5, 10.7, 15.4, 4.9, 3.8, 6.0, 18.9, 11.2, 7.3];
const surfaceTiO2 = [0.4, 0.3, 1.2, 7.4, 9.1, 0.5, 2.1, 3.2, 6.6, 10.4, 1.4, 0.6, 2.8, 2.4, 0.3, 0.2, 0.7, 8.2, 3.6, 1.0];

export const SAMPLE_SURFACE: SurfaceAnalysisPublic = {
  taskId: "surface-analysis",
  rows: 4,
  cols: 5,
  regions: surfaceTerrain.map((terrain, i) => ({
    id: `r${i}`,
    row: Math.floor(i / 5),
    col: i % 5,
    feO: surfaceFeO[i],
    tiO2: surfaceTiO2[i],
    albedo: terrain === "mare" ? 0.22 + (i % 3) * 0.03 : terrain === "highland" ? 0.68 + (i % 4) * 0.04 : 0.5,
    terrain,
  })),
  criterion: "Select every region with TiO2 ≥ 6% and FeO ≥ 15% (high-titanium mare basalt).",
  minTiO2: 6,
  minFeO: 15,
  hint: "High-titanium basalts are found in the dark, smooth mare regions — but not every mare region qualifies.",
};

export const SAMPLE_COMMS: CommunicationsPublic = {
  taskId: "communications",
  earthAzimuth: 214.5,
  earthElevation: 38,
  toleranceDeg: 4,
  startAzimuth: 20,
  startElevation: 10,
  siteName: "Mare Tranquillitatis Station",
  hint: "Earth sits low in the south-west sky from this site.",
};

export const SAMPLE_POWER: PowerCalibrationPublic = {
  taskId: "power-calibration",
  availableWatts: 240,
  step: 5,
  subsystems: [
    { id: "comms", name: "Communications", minWatts: 20, maxWatts: 45, critical: true },
    { id: "thermal", name: "Thermal Control", minWatts: 25, maxWatts: 60, critical: false },
    { id: "science", name: "Science Payload", minWatts: 30, maxWatts: 70, critical: false },
    { id: "nav", name: "Navigation & GNC", minWatts: 15, maxWatts: 35, critical: true },
    { id: "data", name: "Data Handling", minWatts: 10, maxWatts: 40, critical: false },
  ],
  hint: "Fill the critical systems to their maximum first, then give everything else its minimum.",
};

export const SAMPLE_ORBIT: OrbitCalibrationPublic = {
  taskId: "orbit-calibration",
  currentPeriapsisKm: 110,
  currentApoapsisKm: 820,
  targetPeriapsisKm: 60,
  targetApoapsisKm: 420,
  toleranceKm: 10,
  dvMin: -200,
  dvMax: 200,
  kmPerMps: 4,
  hint: "Both burns need to be retrograde (negative).",
};

export const SAMPLE_TERRAIN: TerrainMappingPublic = {
  taskId: "terrain-mapping",
  rows: 4,
  cols: 4,
  cellElevations: [3, 4, 3, 2, 2, 3, 1, 1, 1, 0, 1, 2, 0, 1, 2, 4],
  anchors: { 0: "t-high-1", 9: "t-crater-1", 15: "t-ridge-2" },
  tiles: [
    { id: "t-mare-1", kind: "mare", elevation: 1 },
    { id: "t-high-2", kind: "highland", elevation: 4 },
    { id: "t-crater-1", kind: "crater", elevation: 0 },
    { id: "t-rille-1", kind: "rille", elevation: 1 },
    { id: "t-ridge-1", kind: "ridge", elevation: 2 },
    { id: "t-high-1", kind: "highland", elevation: 3 },
    { id: "t-land-1", kind: "landing-site", elevation: 1 },
    { id: "t-mare-2", kind: "mare", elevation: 1 },
    { id: "t-crater-2", kind: "crater", elevation: 0 },
    { id: "t-high-3", kind: "highland", elevation: 3 },
    { id: "t-ridge-2", kind: "ridge", elevation: 4 },
    { id: "t-mare-3", kind: "mare", elevation: 2 },
    { id: "t-high-4", kind: "highland", elevation: 3 },
    { id: "t-ridge-3", kind: "ridge", elevation: 2 },
    { id: "t-rille-2", kind: "rille", elevation: 1 },
    { id: "t-mare-4", kind: "mare", elevation: 2 },
  ],
  clues: [
    "The landing site lies directly east of the rille in row 2.",
    "The two craters are the lowest points of the survey.",
    "A wrinkle ridge borders the eastern edge of the map.",
  ],
  hint: "Start with elevation: each band 0 and 4 cell has only a couple of matching tiles.",
};

export const SAMPLE_TASKS: Record<LunarTaskId, PublicTaskInstance> = {
  "surface-analysis": SAMPLE_SURFACE,
  communications: SAMPLE_COMMS,
  "power-calibration": SAMPLE_POWER,
  "orbit-calibration": SAMPLE_ORBIT,
  "terrain-mapping": SAMPLE_TERRAIN,
};
