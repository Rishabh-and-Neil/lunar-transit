// Procedurally generated textures (no network assets). Each generator is lazy
// and cached at module level so remounting the scene is instant.
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  type Wrapping,
} from "three";
import { clamp01, fbm, makeNoise3, mulberry32, smoothstep } from "./noise";

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean, wrapS: Wrapping = RepeatWrapping): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = wrapS;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function lazy<T>(fn: () => T): () => T {
  let v: T | undefined;
  return () => {
    if (v === undefined) v = fn();
    return v;
  };
}

/** Iterate an equirectangular grid, giving unit-sphere coordinates per pixel. */
function forEachSpherePixel(
  w: number,
  h: number,
  fn: (i: number, x: number, y: number, z: number, lat: number) => void,
): void {
  const cosLon = new Float32Array(w);
  const sinLon = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const lon = ((x + 0.5) / w) * Math.PI * 2;
    cosLon[x] = Math.cos(lon);
    sinLon[x] = Math.sin(lon);
  }
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let x = 0; x < w; x++) fn(y * w + x, cl * cosLon[x], sl, cl * sinLon[x], lat);
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Earth

export interface EarthTextures {
  day: Texture;
  /** R: ocean mask, G: city lights. */
  aux: Texture;
  /** R: cloud density. */
  clouds: Texture;
}

export const getEarthTextures = lazy((): EarthTextures => {
  const W = 1024;
  const H = 512;
  const nC = makeNoise3(11);
  const nW = makeNoise3(23);
  const nM = makeNoise3(37);
  const nK = makeNoise3(53);
  const day = makeCanvas(W, H);
  const aux = makeCanvas(W, H);
  const dImg = day.ctx.createImageData(W, H);
  const aImg = aux.ctx.createImageData(W, H);
  const dd = dImg.data;
  const ad = aImg.data;
  const SEA = 0.06;
  const rnd = mulberry32(99);

  forEachSpherePixel(W, H, (i, x, y, z, lat) => {
    // Domain-warped continents.
    const wx = nW(x * 1.7, y * 1.7, z * 1.7);
    const wy = nW(x * 1.7 + 5.2, y * 1.7 + 1.3, z * 1.7 + 7.7);
    const wz = nW(x * 1.7 + 9.1, y * 1.7 + 3.4, z * 1.7 + 2.8);
    const qx = x + wx * 0.42;
    const qy = y + wy * 0.42;
    const qz = z + wz * 0.42;
    const h = fbm(nC, qx * 1.25, qy * 1.25, qz * 1.25, 6, 2.05, 0.52) + 0.02;
    const alat = Math.abs(lat);
    const latDeg = (alat * 180) / Math.PI;
    const detail = nM(x * 9, y * 9, z * 9);
    const iceEdge = 70 + detail * 5 + nW(x * 3, y * 3, z * 3) * 4;

    let r: number, g: number, b: number;
    let ocean = 0;
    let city = 0;
    if (latDeg > iceEdge) {
      const v = 228 + detail * 18;
      r = v - 6; g = v; b = v + 8;
    } else if (h < SEA) {
      ocean = 1;
      const depth = clamp01((SEA - h) / 0.45);
      const t = Math.sqrt(depth);
      r = lerp(30, 4, t);
      g = lerp(110, 22, t);
      b = lerp(150, 62, t);
      if (SEA - h < 0.025) {
        const s = 1 - (SEA - h) / 0.025;
        r = lerp(r, 52, s * 0.7); g = lerp(g, 150, s * 0.7); b = lerp(b, 165, s * 0.7);
      }
      // warmer tropical waters
      const trop = 1 - smoothstep(10, 40, latDeg);
      g += trop * 8; b -= trop * 4;
    } else {
      const e = clamp01((h - SEA) / 0.5);
      const moistN = fbm(nM, x * 2.2, y * 2.2, z * 2.2, 3);
      const desertBand = Math.exp(-((latDeg - 24) * (latDeg - 24)) / 120);
      const moist = clamp01(0.55 + moistN * 0.8 - desertBand * 0.55 - e * 0.2);
      const temp = clamp01(1 - latDeg / 75 - e * 0.5);
      // biomes
      const forest = [28, 72, 34];
      const grass = [92, 118, 52];
      const desert = [200, 168, 112];
      const dry = [158, 120, 76];
      const tundra = [120, 116, 98];
      const rock = [112, 98, 84];
      let c: number[];
      const wet = moist > 0.5 ? forest : grass;
      const m2 = smoothstep(0.25, 0.6, moist);
      const warm = [
        lerp(lerp(desert[0], dry[0], smoothstep(0.1, 0.3, moist)), wet[0], m2),
        lerp(lerp(desert[1], dry[1], smoothstep(0.1, 0.3, moist)), wet[1], m2),
        lerp(lerp(desert[2], dry[2], smoothstep(0.1, 0.3, moist)), wet[2], m2),
      ];
      const cold = smoothstep(0.35, 0.12, temp);
      c = [lerp(warm[0], tundra[0], cold), lerp(warm[1], tundra[1], cold), lerp(warm[2], tundra[2], cold)];
      const mount = smoothstep(0.35, 0.75, e);
      c = [lerp(c[0], rock[0], mount), lerp(c[1], rock[1], mount), lerp(c[2], rock[2], mount)];
      const snow = smoothstep(0.62, 0.8, e + (1 - temp) * 0.35) ;
      c = [lerp(c[0], 235, snow), lerp(c[1], 238, snow), lerp(c[2], 242, snow)];
      const v = 1 + detail * 0.09;
      r = c[0] * v; g = c[1] * v; b = c[2] * v;
      // city lights
      const coast = 1 - clamp01((h - SEA) / 0.12);
      const cl = fbm(nK, x * 16, y * 16, z * 16, 3);
      const habit = clamp01(temp * 1.6 - 0.25) * (0.35 + moist * 0.9) * (1 - mount * 0.8);
      city = smoothstep(0.3, 0.72, cl + coast * 0.2) * habit * habit;
      if (rnd() < 0.006 * habit) city = Math.max(city, 0.5 + rnd() * 0.5);
      city = clamp01(city * 1.2);
    }
    const o = i * 4;
    dd[o] = r; dd[o + 1] = g; dd[o + 2] = b; dd[o + 3] = 255;
    ad[o] = ocean * 255; ad[o + 1] = city * 255; ad[o + 2] = 0; ad[o + 3] = 255;
  });
  day.ctx.putImageData(dImg, 0, 0);
  aux.ctx.putImageData(aImg, 0, 0);

  // Clouds
  const CW = 1024;
  const CH = 512;
  const cl = makeCanvas(CW, CH);
  const cImg = cl.ctx.createImageData(CW, CH);
  const cd = cImg.data;
  const nA = makeNoise3(71);
  const nB = makeNoise3(83);
  forEachSpherePixel(CW, CH, (i, x, y, z, lat) => {
    const wx = nB(x * 1.5, y * 1.5, z * 1.5) * 0.18;
    const wy = nB(x * 1.5 + 3.1, y * 1.5 + 7.2, z * 1.5 + 1.7) * 0.18;
    const v = fbm(nA, (x + wx) * 3.2, (y + wy) * 4.2, (z + wx) * 3.2, 6, 2.2, 0.5);
    const latDeg = (Math.abs(lat) * 180) / Math.PI;
    const bands = 0.12 * Math.exp(-(latDeg * latDeg) / 60) + 0.1 * Math.exp(-((latDeg - 55) * (latDeg - 55)) / 120) - 0.08 * Math.exp(-((latDeg - 25) * (latDeg - 25)) / 80);
    const c = Math.pow(smoothstep(0.12, 0.6, v + bands), 1.4);
    const o = i * 4;
    const val = Math.round(c * 255);
    cd[o] = val; cd[o + 1] = val; cd[o + 2] = val; cd[o + 3] = 255;
  });
  cl.ctx.putImageData(cImg, 0, 0);

  return {
    day: toTexture(day.canvas, true),
    aux: toTexture(aux.canvas, false),
    clouds: toTexture(cl.canvas, false),
  };
});

// ---------------------------------------------------------------------------
// Moon

export interface MoonTextures {
  albedo: Texture;
  bump: Texture;
}

export const getMoonTextures = lazy((): MoonTextures => {
  const W = 1024;
  const H = 512;
  const n = makeNoise3(5);
  const n2 = makeNoise3(17);
  const height = new Float32Array(W * H);
  const albedo = new Float32Array(W * H);
  const px = new Float32Array(W * H);
  const py = new Float32Array(W * H);
  const pz = new Float32Array(W * H);
  forEachSpherePixel(W, H, (i, x, y, z) => {
    px[i] = x; py[i] = y; pz[i] = z;
    const m = fbm(n, x * 1.3, y * 1.3, z * 1.3, 4) + 0.18 * x; // maria concentrated on one hemisphere
    const mare = smoothstep(0.12, 0.3, m);
    const d = fbm(n2, x * 6, y * 6, z * 6, 4);
    albedo[i] = lerp(0.66, 0.34, mare) + d * 0.06;
    height[i] = d * 0.15 - mare * 0.1;
  });

  const rnd = mulberry32(1234);
  const craterCount = 1500;
  for (let c = 0; c < craterCount; c++) {
    // random point on sphere
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const cx = s * Math.cos(th);
    const cy = u;
    const cz = s * Math.sin(th);
    const r = 0.006 + 0.16 * Math.pow(rnd(), 5.5); // angular radius (rad)
    const young = rnd() < 0.12;
    const depth = 0.9 * Math.min(r, 0.06) * 6;
    const lat0 = Math.asin(cy);
    const reach = r * 2.6;
    const yMin = Math.max(0, Math.floor((0.5 - (lat0 + reach) / Math.PI) * H));
    const yMax = Math.min(H - 1, Math.ceil((0.5 - (lat0 - reach) / Math.PI) * H));
    for (let yy = yMin; yy <= yMax; yy++) {
      const lat = (0.5 - (yy + 0.5) / H) * Math.PI;
      const clat = Math.max(0.03, Math.cos(lat));
      const dLon = reach / clat;
      let xs: number, xe: number;
      if (dLon >= Math.PI) {
        xs = 0; xe = W - 1;
      } else {
        let lon0 = Math.atan2(cz, cx);
        if (lon0 < 0) lon0 += Math.PI * 2;
        xs = Math.floor(((lon0 - dLon) / (Math.PI * 2)) * W);
        xe = Math.ceil(((lon0 + dLon) / (Math.PI * 2)) * W);
      }
      for (let xx = xs; xx <= xe; xx++) {
        const wxp = ((xx % W) + W) % W;
        const i = yy * W + wxp;
        const dot = px[i] * cx + py[i] * cy + pz[i] * cz;
        const ang = Math.acos(Math.min(1, dot));
        const dn = ang / r;
        if (dn > 2.6) continue;
        if (dn < 1) {
          height[i] -= depth * (1 - dn * dn) * 0.9;
          albedo[i] += young ? 0.05 : -0.025 * (1 - dn);
        }
        const rim = Math.exp(-((dn - 1) * (dn - 1)) / 0.02);
        height[i] += depth * 0.35 * rim;
        if (dn > 1 && young) albedo[i] += 0.12 * (1 - (dn - 1) / 1.6) * (0.6 + 0.4 * Math.sin(Math.atan2(py[i] - cy, px[i] - cx) * 9));
        else if (dn > 1) albedo[i] += 0.025 * Math.max(0, 1 - (dn - 1) / 1.2);
      }
    }
  }

  const a = makeCanvas(W, H);
  const b = makeCanvas(W, H);
  const aImg = a.ctx.createImageData(W, H);
  const bImg = b.ctx.createImageData(W, H);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < W * H; i++) {
    if (height[i] < hMin) hMin = height[i];
    if (height[i] > hMax) hMax = height[i];
  }
  const hr = 1 / (hMax - hMin);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const v = clamp01(albedo[i]) * 255;
    aImg.data[o] = v * 1.02; aImg.data[o + 1] = v; aImg.data[o + 2] = v * 0.96; aImg.data[o + 3] = 255;
    const hv = (height[i] - hMin) * hr * 255;
    bImg.data[o] = hv; bImg.data[o + 1] = hv; bImg.data[o + 2] = hv; bImg.data[o + 3] = 255;
  }
  a.ctx.putImageData(aImg, 0, 0);
  b.ctx.putImageData(bImg, 0, 0);
  return { albedo: toTexture(a.canvas, true), bump: toTexture(b.canvas, false) };
});

// ---------------------------------------------------------------------------
// Sky: nebula + milky way band (equirect)

export const getSkyTexture = lazy((): Texture => {
  const W = 768;
  const H = 384;
  const n1 = makeNoise3(301);
  const n2 = makeNoise3(302);
  const n3 = makeNoise3(303);
  const { canvas, ctx } = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  // galactic plane normal
  const gx = 0.28, gy = 0.86, gz = 0.42;
  const gl = Math.hypot(gx, gy, gz);
  forEachSpherePixel(W, H, (i, x, y, z) => {
    const band = (x * gx + y * gy + z * gz) / gl;
    const bandW = Math.exp(-(band * band) / 0.05);
    const a = fbm(n1, x * 1.6, y * 1.6, z * 1.6, 4);
    const b = fbm(n2, x * 2.4 + 4, y * 2.4, z * 2.4, 4);
    const dust = fbm(n3, x * 5, y * 5, z * 5, 3);
    const neb1 = smoothstep(0.05, 0.65, a) * 0.9;
    const neb2 = smoothstep(0.1, 0.7, b) * 0.8;
    const milky = bandW * (0.55 + 0.45 * fbm(n3, x * 3, y * 3, z * 3, 3)) * (1 - smoothstep(0.0, 0.4, dust) * 0.7);
    let r = 2 + neb1 * 42 + neb2 * 6 + milky * 34;
    let g = 3 + neb1 * 12 + neb2 * 30 + milky * 32;
    let bl = 9 + neb1 * 58 + neb2 * 48 + milky * 40;
    const glow = Math.max(0, a * b) * 30;
    r += glow * 1.2; g += glow * 0.4; bl += glow;
    const o = i * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = bl; d[o + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, true);
});

// ---------------------------------------------------------------------------
// Small sprite textures

export const getGlowTexture = lazy((): Texture => {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.75)");
  g.addColorStop(0.35, "rgba(255,255,255,0.22)");
  g.addColorStop(0.7, "rgba(255,255,255,0.05)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(canvas, false, ClampToEdgeWrapping);
});

export const getFlareTexture = lazy((): Texture => {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.05, "rgba(255,250,235,0.95)");
  g.addColorStop(0.15, "rgba(255,225,170,0.35)");
  g.addColorStop(0.45, "rgba(255,180,110,0.08)");
  g.addColorStop(1, "rgba(255,160,90,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // star spikes
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < 2; k++) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate((k * Math.PI) / 2 + 0.3);
    const lg = ctx.createLinearGradient(-S / 2, 0, S / 2, 0);
    lg.addColorStop(0, "rgba(255,220,180,0)");
    lg.addColorStop(0.5, "rgba(255,240,220,0.6)");
    lg.addColorStop(1, "rgba(255,220,180,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(-S / 2, -1.2, S, 2.4);
    ctx.restore();
  }
  return toTexture(canvas, false, ClampToEdgeWrapping);
});

export const getSparkleTexture = lazy((): Texture => {
  const S = 64;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2 + 2, S / 2); ctx.lineTo(S / 2, S); ctx.lineTo(S / 2 - 2, S / 2); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, S / 2); ctx.lineTo(S / 2, S / 2 - 2); ctx.lineTo(S, S / 2); ctx.lineTo(S / 2, S / 2 + 2); ctx.closePath();
  ctx.fill();
  return toTexture(canvas, false, ClampToEdgeWrapping);
});

export const getWarningTexture = lazy((): Texture => {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(S / 2, 14);
  ctx.lineTo(S - 12, S - 20);
  ctx.lineTo(12, S - 20);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(255,255,255,1)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,1)";
  ctx.fillRect(S / 2 - 5, 46, 10, 34);
  ctx.beginPath();
  ctx.arc(S / 2, 92, 6, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas, false, ClampToEdgeWrapping);
});

export const getSolarPanelTexture = lazy((): Texture => {
  const W = 256;
  const H = 64;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = "#0b1a3d";
  ctx.fillRect(0, 0, W, H);
  const cols = 16;
  const rows = 4;
  const cw = W / cols;
  const ch = H / rows;
  const rnd = mulberry32(42);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = 30 + rnd() * 18;
      ctx.fillStyle = `rgb(${v * 0.35},${v * 0.6},${v * 1.9})`;
      ctx.fillRect(c * cw + 1.5, r * ch + 1.5, cw - 3, ch - 3);
      const g = ctx.createLinearGradient(c * cw, r * ch, c * cw + cw, r * ch + ch);
      g.addColorStop(0, "rgba(140,190,255,0.18)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(c * cw + 1.5, r * ch + 1.5, cw - 3, ch - 3);
    }
  }
  ctx.strokeStyle = "rgba(190,200,215,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  return toTexture(canvas, true, ClampToEdgeWrapping);
});

export const getFoilBumpTexture = lazy((): Texture => {
  const S = 128;
  const n = makeNoise3(909);
  const { canvas, ctx } = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const v = fbm(n, Math.cos(a) * 2, Math.sin(a) * 2, Math.cos(b) * 2 + Math.sin(b) * 2, 4, 2.3, 0.6);
      const c = Math.abs(v) * 255;
      const o = (y * S + x) * 4;
      img.data[o] = c; img.data[o + 1] = c; img.data[o + 2] = c; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(canvas, false);
  t.wrapT = RepeatWrapping;
  return t;
});

/**
 * Optionally pre-generate the heavy procedural textures (~1s CPU total) during idle
 * time, e.g. while the user is on a non-3D screen, so the first SpaceScene mount is instant.
 */
export function warmSceneTextures(): void {
  const jobs: Array<() => unknown> = [getSkyTexture, getMoonTextures, getEarthTextures, getGlowTexture, getSolarPanelTexture, getFoilBumpTexture];
  const run = () => {
    const job = jobs.shift();
    if (!job) return;
    job();
    schedule();
  };
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 2000 });
    else window.setTimeout(run, 50);
  };
  schedule();
}
