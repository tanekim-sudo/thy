import * as THREE from "three";

/** Deterministic PRNG so a given id always grows the same organism. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A living, tapering tube between two points — the body of a filament.
 * Pre-allocated once, then rewritten in place every frame so the thread can
 * sway, breathe, and follow its drifting nodes without GC churn.
 */
export class FilamentTube {
  readonly mesh: THREE.Mesh;
  private tubular: number;
  private radial: number;
  private posAttr: THREE.BufferAttribute;
  private seed: number;
  // organic wander basis, regenerated lazily
  private wanderA = new THREE.Vector3();
  private wanderB = new THREE.Vector3();
  private p0 = new THREE.Vector3();
  private p1 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private lastTime = 0;
  private lastAmpScaled = 0;

  constructor(seed: number, color: THREE.Color, tubular = 26, radial = 7) {
    this.seed = seed;
    this.tubular = tubular;
    this.radial = radial;

    const vertCount = (tubular + 1) * (radial + 1);
    const positions = new Float32Array(vertCount * 3);
    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("position", this.posAttr);

    // Fixed index buffer (topology never changes).
    const indices: number[] = [];
    for (let i = 0; i < tubular; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = (i + 1) * (radial + 1) + j;
        const c = (i + 1) * (radial + 1) + (j + 1);
        const d = i * (radial + 1) + (j + 1);
        indices.push(a, b, d, b, c, d);
      }
    }
    geom.setIndex(indices);

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
  }

  /** Sample the wandering centerline at t∈[0,1]. */
  pointAt(t: number, time: number, amp: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.p0, this.p1, t);
    // bow + sway: zero at ends, max in the middle
    const env = Math.sin(Math.PI * t);
    const s1 = Math.sin(t * 5.3 + time * 0.0009 + this.seed) * env;
    const s2 = Math.sin(t * 8.7 - time * 0.0013 + this.seed * 1.7) * env;
    out.addScaledVector(this.wanderA, s1 * amp);
    out.addScaledVector(this.wanderB, s2 * amp * 0.6);
    return out;
  }

  /**
   * Rewrite geometry from current endpoints.
   * @param baseRadius thickness scalar (driven by strength/traffic)
   * @param amp lateral wander amplitude (driven by length / energy)
   */
  update(
    a: THREE.Vector3,
    b: THREE.Vector3,
    time: number,
    baseRadius: number,
    amp: number
  ) {
    this.p0.copy(a);
    this.p1.copy(b);

    // Build a stable perpendicular basis for this segment.
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length() || 1;
    dir.divideScalar(len);
    this.up.set(0, 1, 0);
    if (Math.abs(dir.dot(this.up)) > 0.95) this.up.set(1, 0, 0);
    this.wanderA.crossVectors(dir, this.up).normalize();
    this.wanderB.crossVectors(dir, this.wanderA).normalize();

    const arr = this.posAttr.array as Float32Array;
    const center = new THREE.Vector3();
    const next = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const nA = new THREE.Vector3();
    const nB = new THREE.Vector3();
    const ring = new THREE.Vector3();

    const ampScaled = amp * Math.min(1, len / 60);
    this.lastTime = time;
    this.lastAmpScaled = ampScaled;

    for (let i = 0; i <= this.tubular; i++) {
      const t = i / this.tubular;
      this.pointAt(t, time, ampScaled, center);
      // tangent via finite difference
      this.pointAt(Math.min(1, t + 0.01), time, ampScaled, next);
      tangent.subVectors(next, center).normalize();
      if (tangent.lengthSq() < 1e-6) tangent.copy(dir);

      // frame perpendicular to tangent
      nA.crossVectors(tangent, this.up).normalize();
      if (nA.lengthSq() < 1e-6) nA.copy(this.wanderA);
      nB.crossVectors(tangent, nA).normalize();

      // spindle taper: fat in the middle, drawn to fine points at both ends
      const taper = Math.pow(Math.sin(Math.PI * t), 0.6);
      const wobble = 0.82 + 0.18 * Math.sin(t * 22 + this.seed);
      const r = baseRadius * (0.18 + 0.82 * taper) * wobble;

      for (let j = 0; j <= this.radial; j++) {
        const ang = (j / this.radial) * Math.PI * 2;
        ring
          .copy(nA)
          .multiplyScalar(Math.cos(ang) * r)
          .addScaledVector(nB, Math.sin(ang) * r)
          .add(center);
        const idx = (i * (this.radial + 1) + j) * 3;
        arr[idx] = ring.x;
        arr[idx + 1] = ring.y;
        arr[idx + 2] = ring.z;
      }
    }
    this.posAttr.needsUpdate = true;
  }

  /** Sample the current (already-updated) centerline at t∈[0,1]. */
  sample(t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.pointAt(t, this.lastTime, this.lastAmpScaled, out);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * Recursive fractal tendrils radiating from a point — the fine hyphal mat that
 * makes the organism read as alive even in empty space. Returns line-segment
 * geometry in LOCAL space (origin at 0,0,0) plus baked per-vertex brightness so
 * tips fade into the void.
 */
export function generateHyphae(
  seed: number,
  opts: { roots?: number; spread?: number; baseLength?: number } = {}
): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const roots = opts.roots ?? 7;
  const spread = opts.spread ?? 1;
  const baseLength = opts.baseLength ?? 26;

  const positions: number[] = [];
  const colors: number[] = [];

  const addSeg = (
    x1: number,
    y1: number,
    z1: number,
    b1: number,
    x2: number,
    y2: number,
    z2: number,
    b2: number
  ) => {
    positions.push(x1, y1, z1, x2, y2, z2);
    colors.push(b1, b1, b1, b2, b2, b2);
  };

  const grow = (
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    length: number,
    depth: number,
    bright: number
  ) => {
    if (depth <= 0 || length < 1.5) return;
    const steps = Math.max(2, Math.floor(length / 4));
    const stepLen = length / steps;
    let px = x,
      py = y,
      pz = z;
    let pb = bright;
    for (let s = 0; s < steps; s++) {
      // curve the direction a little each step — threads wander
      dx += (rand() - 0.5) * 0.5 * spread;
      dy += (rand() - 0.5) * 0.5 * spread;
      dz += (rand() - 0.5) * 0.5 * spread;
      const m = Math.hypot(dx, dy, dz) || 1;
      dx /= m;
      dy /= m;
      dz /= m;
      const nx = px + dx * stepLen;
      const ny = py + dy * stepLen;
      const nz = pz + dz * stepLen;
      const nb = pb * 0.86;
      addSeg(px, py, pz, pb, nx, ny, nz, nb);
      px = nx;
      py = ny;
      pz = nz;
      pb = nb;

      // occasional branch
      if (rand() < 0.32 && depth > 1) {
        const bx = dx + (rand() - 0.5) * 1.4;
        const by = dy + (rand() - 0.5) * 1.4;
        const bz = dz + (rand() - 0.5) * 1.4;
        grow(px, py, pz, bx, by, bz, length * (0.45 + rand() * 0.25), depth - 1, pb * 0.9);
      }
    }
  };

  for (let r = 0; r < roots; r++) {
    // even-ish distribution on a sphere, biased outward
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(2 * rand() - 1);
    const dx = Math.sin(phi) * Math.cos(theta);
    const dy = Math.sin(phi) * Math.sin(theta);
    const dz = Math.cos(phi) * 0.7;
    grow(0, 0, 0, dx, dy, dz, baseLength * (0.7 + rand() * 0.7), 3, 0.9);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geom;
}
