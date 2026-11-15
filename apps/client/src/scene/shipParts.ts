// Shared (module-level) geometries & materials for the spacecraft model.
// Created lazily once and reused by every ship instance and the shop preview.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  LatheGeometry,
  type Material,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  SpriteMaterial,
  TetrahedronGeometry,
  TorusGeometry,
  Vector2,
} from "three";
import { getFoilBumpTexture, getGlowTexture, getSolarPanelTexture } from "./textures";

function zCyl(rTop: number, rBot: number, h: number, seg = 24, open = false, thetaStart = 0, thetaLen = Math.PI * 2): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBot, h, seg, 1, open, thetaStart, thetaLen);
  g.rotateX(Math.PI / 2); // +Y (top) -> +Z (nose direction)
  return g;
}

function nozzleGeo(scale = 1): BufferGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new Vector2((0.055 + 0.09 * Math.pow(t, 0.75)) * scale, -t * 0.22 * scale));
  }
  const g = new LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2);
  return g;
}

function flameGeo(): BufferGeometry {
  const g = new CylinderGeometry(1, 0.04, 1, 20, 8, true);
  g.translate(0, -0.5, 0); // top at origin, extends to -1
  g.rotateX(Math.PI / 2); // extends toward -Z
  return g;
}

function dishGeo(): BufferGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const r = (i / 10) * 0.2;
    pts.push(new Vector2(r, (r * r) / 0.2 * 0.35));
  }
  return new LatheGeometry(pts, 32);
}

export interface ShipGeometries {
  capsule: BufferGeometry;
  dockTip: BufferGeometry;
  band: BufferGeometry;
  adapter: BufferGeometry;
  service: BufferGeometry;
  smBand: BufferGeometry;
  aft: BufferGeometry;
  nozzle: BufferGeometry;
  smallNozzle: BufferGeometry;
  flame: BufferGeometry;
  boom: BufferGeometry;
  panel: BufferGeometry;
  yoke: BufferGeometry;
  window: BufferGeometry;
  whipple: BufferGeometry;
  vaultRing: BufferGeometry;
  vaultStripe: BufferGeometry;
  foil: BufferGeometry;
  deflectorRing: BufferGeometry;
  coil: BufferGeometry;
  pod: BufferGeometry;
  podGrid: BufferGeometry;
  pylon: BufferGeometry;
  booster: BufferGeometry;
  boosterNose: BufferGeometry;
  mast: BufferGeometry;
  sail: BufferGeometry;
  sailBoom: BufferGeometry;
  rcsBlock: BufferGeometry;
  rcsNozzle: BufferGeometry;
  trackerBox: BufferGeometry;
  trackerHood: BufferGeometry;
  dish: BufferGeometry;
  feed: BufferGeometry;
  dishBoom: BufferGeometry;
  specBox: BufferGeometry;
  specAperture: BufferGeometry;
  droneBody: BufferGeometry;
  droneRing: BufferGeometry;
  shard: BufferGeometry;
  sphere: BufferGeometry;
}

let geos: ShipGeometries | null = null;
export function getShipGeometries(): ShipGeometries {
  if (geos) return geos;
  const boom = new CylinderGeometry(0.014, 0.014, 1, 8);
  boom.rotateZ(Math.PI / 2); // along X
  const sailBoom = new CylinderGeometry(0.006, 0.006, 1, 6);
  sailBoom.rotateZ(Math.PI / 2);
  const mast = new CylinderGeometry(0.01, 0.012, 1, 8);
  const trackerHood = new CylinderGeometry(0.028, 0.036, 0.08, 16, 1, true);
  const specAperture = new CylinderGeometry(0.035, 0.035, 0.04, 16);
  const feed = new CylinderGeometry(0.012, 0.02, 0.09, 8);
  const dishBoom = new CylinderGeometry(0.012, 0.012, 1, 8);
  geos = {
    capsule: zCyl(0.11, 0.25, 0.32, 32),
    dockTip: zCyl(0.065, 0.08, 0.06, 20),
    band: zCyl(0.253, 0.253, 0.028, 32),
    adapter: zCyl(0.256, 0.256, 0.05, 32),
    service: zCyl(0.245, 0.245, 0.5, 32),
    smBand: zCyl(0.25, 0.25, 0.022, 32),
    aft: zCyl(0.245, 0.17, 0.06, 32),
    nozzle: nozzleGeo(1),
    smallNozzle: nozzleGeo(0.45),
    flame: flameGeo(),
    boom,
    panel: new BoxGeometry(0.7, 0.012, 0.26),
    yoke: new BoxGeometry(0.05, 0.03, 0.3),
    window: new BoxGeometry(0.05, 0.03, 0.02),
    whipple: zCyl(0.315, 0.315, 0.44, 24, true, Math.PI - 0.9, 1.8),
    vaultRing: new TorusGeometry(0.27, 0.045, 12, 40),
    vaultStripe: new TorusGeometry(0.312, 0.01, 6, 40),
    foil: zCyl(0.252, 0.252, 0.42, 32),
    deflectorRing: new TorusGeometry(0.62, 0.012, 6, 64),
    coil: new SphereGeometry(0.035, 12, 8),
    pod: zCyl(0.055, 0.055, 0.26, 16),
    podGrid: zCyl(0.05, 0.05, 0.01, 16),
    pylon: new BoxGeometry(0.03, 0.12, 0.12),
    booster: zCyl(0.065, 0.065, 0.42, 20),
    boosterNose: zCyl(0.0, 0.065, 0.12, 20),
    mast,
    sail: new PlaneGeometry(0.72, 0.72, 8, 8),
    sailBoom,
    rcsBlock: new BoxGeometry(0.06, 0.05, 0.07),
    rcsNozzle: zCyl(0.008, 0.016, 0.03, 8),
    trackerBox: new BoxGeometry(0.075, 0.06, 0.09),
    trackerHood,
    dish: dishGeo(),
    feed,
    dishBoom,
    specBox: new BoxGeometry(0.15, 0.08, 0.16),
    specAperture,
    droneBody: new OctahedronGeometry(0.06, 1),
    droneRing: new TorusGeometry(0.085, 0.012, 6, 24),
    shard: new TetrahedronGeometry(0.06, 0),
    sphere: new SphereGeometry(1, 32, 20),
  };
  return geos;
}

export interface ShipMaterials {
  hull: Material;
  metal: Material;
  dark: Material;
  gold: Material;
  panel: Material;
  shield: Material;
  lead: Material;
  hazardStripe: Material;
  lens: Material;
  sail: Material;
  windowGlass: Material;
  deflector: Material;
  ion: Material;
  green: Material;
}

let mats: ShipMaterials | null = null;
export function getShipMaterials(): ShipMaterials {
  if (mats) return mats;
  const foil = getFoilBumpTexture();
  mats = {
    hull: new MeshStandardMaterial({ color: "#cfd5de", metalness: 0.25, roughness: 0.5 }),
    metal: new MeshStandardMaterial({ color: "#b9c2cf", metalness: 0.85, roughness: 0.3 }),
    dark: new MeshStandardMaterial({ color: "#2b313b", metalness: 0.7, roughness: 0.45, side: DoubleSide }),
    gold: new MeshStandardMaterial({ color: "#e0aa45", metalness: 1, roughness: 0.3, bumpMap: foil, bumpScale: 1.4, emissive: new Color("#3a2306"), emissiveIntensity: 0.6 }),
    panel: new MeshStandardMaterial({ map: getSolarPanelTexture(), metalness: 0.55, roughness: 0.3, emissive: new Color("#0c1d48"), emissiveIntensity: 0.6 }),
    shield: new MeshStandardMaterial({ color: "#9fb0c4", metalness: 0.8, roughness: 0.38, side: DoubleSide }),
    lead: new MeshStandardMaterial({ color: "#454a55", metalness: 0.75, roughness: 0.5 }),
    hazardStripe: new MeshStandardMaterial({ color: "#ffcc33", emissive: new Color("#ffb800"), emissiveIntensity: 1.6, toneMapped: false }),
    lens: new MeshStandardMaterial({ color: "#0b0f16", metalness: 1, roughness: 0.08, side: DoubleSide }),
    sail: new MeshPhysicalMaterial({
      color: "#c9d3f0",
      metalness: 1,
      roughness: 0.16,
      iridescence: 1,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [200, 700],
      side: DoubleSide,
      transparent: true,
      opacity: 0.88,
      emissive: new Color("#1a2140"),
      emissiveIntensity: 0.4,
    }),
    windowGlass: new MeshStandardMaterial({ color: "#0c1420", emissive: new Color("#7fd6ff"), emissiveIntensity: 0.6, metalness: 0.9, roughness: 0.1 }),
    deflector: new MeshStandardMaterial({ color: "#5a3a9a", emissive: new Color("#8a5cff"), emissiveIntensity: 1.3, toneMapped: false }),
    ion: new MeshStandardMaterial({ color: "#7fc8ff", emissive: new Color("#4aa8ff"), emissiveIntensity: 2.6, toneMapped: false }),
    green: new MeshStandardMaterial({ color: "#7dffb0", emissive: new Color("#3dff8a"), emissiveIntensity: 2.2, toneMapped: false }),
  };
  return mats;
}

const accentCache = new Map<string, MeshStandardMaterial>();
export function getAccentMaterial(color: string): MeshStandardMaterial {
  let m = accentCache.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, emissive: new Color(color), emissiveIntensity: 2.2, toneMapped: false });
    accentCache.set(color, m);
  }
  return m;
}

export function makeGlowSprite(color: string, opacity = 1): SpriteMaterial {
  return new SpriteMaterial({
    map: getGlowTexture(),
    color: new Color(color),
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
}

const flameVert = /* glsl */ `
varying vec2 vUv; varying vec3 vNV; varying vec3 vPV;
void main(){
  vUv = uv;
  vNV = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const flameFrag = /* glsl */ `
uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform float uSeed;
varying vec2 vUv; varying vec3 vNV; varying vec3 vPV;
void main(){
  float along = vUv.y; // 1 at nozzle, 0 at tip
  float fres = abs(dot(normalize(vNV), normalize(-vPV)));
  float body = pow(along, 1.7) * pow(fres, 1.3);
  float shock = 0.75 + 0.25 * sin(along * 38.0 - uTime * 30.0 + uSeed);
  float flick = 0.88 + 0.12 * sin(uTime * 53.0 + vUv.x * 25.0 + uSeed * 3.0);
  vec3 hot = mix(uColor, vec3(1.0, 0.98, 0.95), pow(along, 5.0) * 0.85);
  gl_FragColor = vec4(hot * body * shock * flick * uIntensity, 1.0);
}`;

export function makeFlameMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: flameVert,
    fragmentShader: flameFrag,
    uniforms: {
      uColor: { value: new Color(color) },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 10 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}
