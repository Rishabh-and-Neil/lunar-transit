// Tiny CPU particle system rendered as additive point sprites (one draw call each).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  type Color,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  type WebGLRenderer,
} from "three";
import { getSparkleTexture, getGlowTexture } from "./textures";

const vert = /* glsl */ `
attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
uniform float uScale;
varying vec3 vColor; varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(256.0, aSize * uScale / max(0.001, -mv.z));
  vColor = aColor; vAlpha = aAlpha;
}`;
const frag = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor; varying float vAlpha;
void main(){
  float t = texture2D(uMap, gl_PointCoord).r;
  float a = t * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export class ParticleSystem {
  readonly points: Points;
  readonly material: ShaderMaterial;
  private readonly geo: BufferGeometry;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly baseCol: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly swirl: Float32Array;
  private head = 0;
  private liveCount = 0;
  drag = 0.6;

  constructor(capacity: number, sparkle = false) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.baseCol = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.swirl = new Float32Array(capacity);
    this.geo = new BufferGeometry();
    this.geo.setAttribute("position", new BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aColor", new BufferAttribute(this.col, 3));
    this.geo.setAttribute("aAlpha", new BufferAttribute(this.alpha, 1));
    this.geo.setAttribute("aSize", new BufferAttribute(this.size, 1));
    this.material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uScale: { value: 500 }, uMap: { value: sparkle ? getSparkleTexture() : getGlowTexture() } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.points = new Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: Color, life: number, size0: number, size1: number, swirl = 0, brightness = 1,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.baseCol[o] = color.r * brightness; this.baseCol[o + 1] = color.g * brightness; this.baseCol[o + 2] = color.b * brightness;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.swirl[i] = swirl;
    this.liveCount = Math.min(this.cap, this.liveCount + 1);
  }

  /** Swirl rotates velocity around the local Z axis (rad/s). */
  update(dt: number): void {
    const dragF = Math.exp(-this.drag * dt);
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      const life = this.life[i];
      let a = this.age[i];
      if (a >= life) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
          any = true;
        }
        continue;
      }
      any = true;
      a += dt;
      this.age[i] = a;
      const o = i * 3;
      if (this.swirl[i] !== 0) {
        const ang = this.swirl[i] * dt;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const vx = this.vel[o];
        const vy = this.vel[o + 1];
        this.vel[o] = vx * c - vy * s;
        this.vel[o + 1] = vx * s + vy * c;
      }
      this.vel[o] *= dragF; this.vel[o + 1] *= dragF; this.vel[o + 2] *= dragF;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const t = Math.min(1, a / life);
      const fadeIn = Math.min(1, t / 0.06);
      this.alpha[i] = Math.pow(1 - t, 1.6) * fadeIn;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const heat = 1 - t;
      this.col[o] = this.baseCol[o] * (0.6 + 0.4 * heat) + heat * heat * 0.25;
      this.col[o + 1] = this.baseCol[o + 1] * (0.6 + 0.4 * heat) + heat * heat * 0.25;
      this.col[o + 2] = this.baseCol[o + 2] * (0.6 + 0.4 * heat) + heat * heat * 0.25;
    }
    if (any) {
      (this.geo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute("aColor") as BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute("aSize") as BufferAttribute).needsUpdate = true;
    }
    this.points.visible = any;
  }

  setScaleFromCamera(camera: Camera, gl: WebGLRenderer): void {
    if (camera instanceof PerspectiveCamera) {
      const h = gl.domElement.height;
      this.material.uniforms.uScale.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
