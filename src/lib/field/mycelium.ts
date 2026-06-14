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
 * 18.2 — A connection drawn as a Lichtenberg figure.
 *
 * Never a straight line and never uniform width. The main channel is a catenary
 * (hanging-chain) curve — sag proportional to distance, inversely proportional
 * to strength, so a brand-new weak connection droops like a fresh vine and a
 * thick, well-used one is nearly taut. Width tapers end-to-end with sqrt(mass)
 * of each endpoint fragment. Along that channel, micro-branches spawn at
 * intervals set by strength, each a short tapered ribbon that may grow one
 * further sub-branch — a simple recursive rule, depth-capped at 2. The result:
 * a weak connection is one clean thread; a much-traversed one reads like a
 * river system seen from above, a main channel with tributaries.
 *
 * The whole structure renders in a single additive mesh (structural light,
 * intensity = strength). Topology is fixed and rewritten in place each frame;
 * inactive branches collapse to a point and disappear. The travelling pulse
 * (vital light) is drawn separately by the caller along {@link sampleMain}.
 */
const LF_MAIN_TUBULAR = 30;
const LF_MAIN_RADIAL = 6;
const LF_BRANCH_SLOTS = 12;
const LF_BRANCH_TUBULAR = 6;
const LF_BRANCH_RADIAL = 4;
const LF_SUB_TUBULAR = 4;
const LF_SUB_RADIAL = 3;

interface BranchSpec {
  t: number; // position along the main curve [0,1]
  threshold: number; // becomes active once strength exceeds this
  angle: number; // signed branch angle off the tangent (radians)
  lenFrac: number; // length as a fraction of the main span
  hasSub: boolean; // whether a depth-2 sub-branch is permitted
  subAngle: number;
  subLenFrac: number;
}

export class LichtenbergFilament {
  readonly mesh: THREE.Mesh;
  private posAttr: THREE.BufferAttribute;
  private seed: number;
  private branches: BranchSpec[];

  private mainVerts: number;
  private branchVerts: number;
  private subVerts: number;
  private branchBase: number; // first vertex index of branch region

  // Per-update centerline state (also used by sampleMain for the pulse).
  private p0 = new THREE.Vector3();
  private p1 = new THREE.Vector3();
  private wanderA = new THREE.Vector3();
  private wanderB = new THREE.Vector3();
  private down = new THREE.Vector3(0, -1, 0);
  private up = new THREE.Vector3(0, 1, 0);
  private dist = 1;
  private sag = 0;
  private sway = 0;
  private rA = 1;
  private rB = 1;
  private time = 0;

  // Scratch.
  private _c = new THREE.Vector3();
  private _n = new THREE.Vector3();
  private _tan = new THREE.Vector3();
  private _nA = new THREE.Vector3();
  private _nB = new THREE.Vector3();
  private _ring = new THREE.Vector3();
  private _base = new THREE.Vector3();
  private _end = new THREE.Vector3();
  private _dir = new THREE.Vector3();
  private _side = new THREE.Vector3();
  private _subEnd = new THREE.Vector3();

  constructor(seed: number, color: THREE.Color) {
    this.seed = seed;
    const rand = mulberry32(seed);

    // Deterministic branch field. Candidate points are spread along the curve,
    // each with an activation threshold so that as strength climbs, more of
    // them light up — accumulated thinking visibly accumulates.
    this.branches = [];
    for (let i = 0; i < LF_BRANCH_SLOTS; i++) {
      const base = (i + 0.5) / LF_BRANCH_SLOTS;
      const t = Math.min(0.93, Math.max(0.07, base + (rand() - 0.5) * 0.06));
      const sign = rand() < 0.5 ? -1 : 1;
      const angle = sign * (0.26 + rand() * 0.35); // 15°–35°
      this.branches.push({
        t,
        threshold: 0.08 + rand() * 0.85,
        angle,
        lenFrac: 0.1 + rand() * 0.05, // 10–15% of the span
        hasSub: rand() < 0.15, // sub-branch only at low probability…
        subAngle: (rand() < 0.5 ? -1 : 1) * (0.26 + rand() * 0.35),
        subLenFrac: 0.5 + rand() * 0.3, // …relative to its parent branch
      });
    }

    this.mainVerts = (LF_MAIN_TUBULAR + 1) * (LF_MAIN_RADIAL + 1);
    this.branchVerts = (LF_BRANCH_TUBULAR + 1) * (LF_BRANCH_RADIAL + 1);
    this.subVerts = (LF_SUB_TUBULAR + 1) * (LF_SUB_RADIAL + 1);
    this.branchBase = this.mainVerts;
    const totalVerts =
      this.mainVerts + LF_BRANCH_SLOTS * (this.branchVerts + this.subVerts);

    const positions = new Float32Array(totalVerts * 3);
    const geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("position", this.posAttr);

    // Fixed index buffer covering the main channel and every branch/sub slot.
    const indices: number[] = [];
    const addTubeIndices = (offset: number, tubular: number, radial: number) => {
      for (let i = 0; i < tubular; i++) {
        for (let j = 0; j < radial; j++) {
          const a = offset + i * (radial + 1) + j;
          const b = offset + (i + 1) * (radial + 1) + j;
          const c = offset + (i + 1) * (radial + 1) + (j + 1);
          const d = offset + i * (radial + 1) + (j + 1);
          indices.push(a, b, d, b, c, d);
        }
      }
    };
    addTubeIndices(0, LF_MAIN_TUBULAR, LF_MAIN_RADIAL);
    let off = this.branchBase;
    for (let i = 0; i < LF_BRANCH_SLOTS; i++) {
      addTubeIndices(off, LF_BRANCH_TUBULAR, LF_BRANCH_RADIAL);
      off += this.branchVerts;
      addTubeIndices(off, LF_SUB_TUBULAR, LF_SUB_RADIAL);
      off += this.subVerts;
    }
    geom.setIndex(indices);

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geom, mat);
    this.mesh.frustumCulled = false;
  }

  /** Centerline of the main channel — a sagging catenary with a faint breath. */
  private mainPoint(t: number, out: THREE.Vector3): THREE.Vector3 {
    out.lerpVectors(this.p0, this.p1, t);
    // Catenary droop: zero at both ends, deepest at the middle.
    out.addScaledVector(this.down, this.sag * 4 * t * (1 - t));
    // A small residual sway keeps the resting line alive without hiding the sag.
    if (this.sway > 0) {
      const env = Math.sin(Math.PI * t);
      out.addScaledVector(
        this.wanderA,
        Math.sin(t * 4.0 + this.time * 0.0008 + this.seed) * this.sway * env
      );
      out.addScaledVector(
        this.wanderB,
        Math.sin(t * 6.5 - this.time * 0.0011 + this.seed * 1.7) * this.sway * 0.5 * env
      );
    }
    return out;
  }

  /** Width of the main channel at t — interpolated from each endpoint's sqrt(mass). */
  private mainRadius(t: number): number {
    const wobble = 0.86 + 0.14 * Math.sin(t * 19 + this.seed);
    return (this.rA + (this.rB - this.rA) * t) * wobble;
  }

  private frame(tangent: THREE.Vector3, nA: THREE.Vector3, nB: THREE.Vector3) {
    this.up.set(0, 1, 0);
    if (Math.abs(tangent.dot(this.up)) > 0.95) this.up.set(1, 0, 0);
    nA.crossVectors(tangent, this.up).normalize();
    if (nA.lengthSq() < 1e-6) nA.copy(this.wanderA);
    nB.crossVectors(tangent, nA).normalize();
  }

  private writeRing(arr: Float32Array, vIndex: number, center: THREE.Vector3, nA: THREE.Vector3, nB: THREE.Vector3, r: number, radial: number) {
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      this._ring
        .copy(nA)
        .multiplyScalar(Math.cos(ang) * r)
        .addScaledVector(nB, Math.sin(ang) * r)
        .add(center);
      const idx = (vIndex + j) * 3;
      arr[idx] = this._ring.x;
      arr[idx + 1] = this._ring.y;
      arr[idx + 2] = this._ring.z;
    }
  }

  /** A short straight tapered tube — used for branches and sub-branches. */
  private buildStraight(arr: Float32Array, offset: number, start: THREE.Vector3, end: THREE.Vector3, r0: number, r1: number, tubular: number, radial: number) {
    this._tan.subVectors(end, start);
    if (this._tan.lengthSq() < 1e-8) {
      this.collapse(arr, offset, (tubular + 1) * (radial + 1), start);
      return;
    }
    this._tan.normalize();
    this.frame(this._tan, this._nA, this._nB);
    for (let i = 0; i <= tubular; i++) {
      const t = i / tubular;
      this._c.lerpVectors(start, end, t);
      const r = (r0 + (r1 - r0) * t) * Math.pow(1 - t * 0.85, 0.5);
      this.writeRing(arr, offset + i * (radial + 1), this._c, this._nA, this._nB, Math.max(0, r), radial);
    }
  }

  /** Collapse a slot's vertices to a single point so it renders nothing. */
  private collapse(arr: Float32Array, offset: number, vertCount: number, point: THREE.Vector3) {
    for (let k = 0; k < vertCount; k++) {
      const idx = (offset + k) * 3;
      arr[idx] = point.x;
      arr[idx + 1] = point.y;
      arr[idx + 2] = point.z;
    }
  }

  /**
   * Rewrite the whole figure from current endpoints.
   * @param massA / massB drive end-to-end taper (width ∝ sqrt(mass)).
   * @param branchStrength drives micro-branch density (18.3 pruning phase).
   * @param mainStrength drives main-channel width/brightness (18.3 fade phase).
   * @param sagStrength actual connection strength for catenary sag.
   * @param energyAmp lateral sway amplitude from the field's energy state.
   */
  update(
    a: THREE.Vector3,
    b: THREE.Vector3,
    massA: number,
    massB: number,
    branchStrength: number,
    mainStrength: number,
    sagStrength: number,
    time: number,
    energyAmp: number
  ) {
    this.p0.copy(a);
    this.p1.copy(b);
    this.time = time;

    this._dir.subVectors(b, a);
    this.dist = this._dir.length() || 1;
    this._dir.divideScalar(this.dist);

    // Lateral basis for sway and branch sides.
    this.up.set(0, 1, 0);
    if (Math.abs(this._dir.dot(this.up)) > 0.95) this.up.set(1, 0, 0);
    this.wanderA.crossVectors(this._dir, this.up).normalize();
    this.wanderB.crossVectors(this._dir, this.wanderA).normalize();

    const branchS = Math.max(0, Math.min(1, branchStrength));
    const mainS = Math.max(0, Math.min(1, mainStrength));
    const sagS = Math.max(0, Math.min(1, sagStrength));
    // Sag ∝ distance, inversely ∝ strength.
    this.sag = this.dist * 0.16 * (1 - 0.7 * sagS);
    this.sway = energyAmp * Math.min(1, this.dist / 120) * 0.3;
    // Width ∝ sqrt(mass) at each end, scaled by main-channel health.
    const mainScale = 0.25 + 0.75 * mainS;
    this.rA = (0.4 + Math.sqrt(Math.max(0, massA)) * 1.4) * mainScale;
    this.rB = (0.4 + Math.sqrt(Math.max(0, massB)) * 1.4) * mainScale;

    const arr = this.posAttr.array as Float32Array;

    // ---- Main channel ----
    for (let i = 0; i <= LF_MAIN_TUBULAR; i++) {
      const t = i / LF_MAIN_TUBULAR;
      this.mainPoint(t, this._c);
      this.mainPoint(Math.min(1, t + 0.01), this._n);
      this._tan.subVectors(this._n, this._c).normalize();
      if (this._tan.lengthSq() < 1e-6) this._tan.copy(this._dir);
      this.frame(this._tan, this._nA, this._nB);
      const edge = Math.min(t, 1 - t);
      const tip = 0.15 + 0.85 * Math.min(1, edge / 0.04);
      this.writeRing(arr, i * (LF_MAIN_RADIAL + 1), this._c, this._nA, this._nB, this.mainRadius(t) * tip, LF_MAIN_RADIAL);
    }

    // ---- Micro-branches (recursive, depth-capped at 2) ----
    let off = this.branchBase;
    for (let k = 0; k < LF_BRANCH_SLOTS; k++) {
      const br = this.branches[k];
      const active = branchS > br.threshold;
      if (!active) {
        this.mainPoint(br.t, this._base);
        this.collapse(arr, off, this.branchVerts, this._base);
        this.collapse(arr, off + this.branchVerts, this.subVerts, this._base);
        off += this.branchVerts + this.subVerts;
        continue;
      }

      // Branch base + local tangent on the main curve.
      this.mainPoint(br.t, this._base);
      this.mainPoint(Math.min(1, br.t + 0.01), this._end);
      this._tan.subVectors(this._end, this._base).normalize();
      if (this._tan.lengthSq() < 1e-6) this._tan.copy(this._dir);

      // Branch direction: tangent rotated toward the lateral basis by br.angle.
      this._side.copy(this.wanderA);
      this._dir
        .copy(this._tan)
        .multiplyScalar(Math.cos(br.angle))
        .addScaledVector(this._side, Math.sin(br.angle))
        .addScaledVector(this.wanderB, Math.sin(br.angle) * 0.25)
        .normalize();

      const len = br.lenFrac * this.dist;
      this._end.copy(this._base).addScaledVector(this._dir, len);
      const rBase = this.mainRadius(br.t) * 0.5;
      const rTip = Math.max(0.05, rBase * 0.18);
      this.buildStraight(arr, off, this._base, this._end, rBase, rTip, LF_BRANCH_TUBULAR, LF_BRANCH_RADIAL);
      off += this.branchVerts;

      // Sub-branch: only for sufficiently strong, eligible branches.
      if (br.hasSub && branchS > 0.6) {
        this._side.copy(this.wanderB);
        this._subEnd
          .copy(this._dir)
          .multiplyScalar(Math.cos(br.subAngle))
          .addScaledVector(this._side, Math.sin(br.subAngle))
          .normalize();
        const subLen = br.subLenFrac * len;
        this._subEnd.multiplyScalar(subLen).add(this._end);
        this.buildStraight(arr, off, this._end, this._subEnd, rTip, Math.max(0.03, rTip * 0.4), LF_SUB_TUBULAR, LF_SUB_RADIAL);
      } else {
        this.collapse(arr, off, this.subVerts, this._end);
      }
      off += this.subVerts;
    }

    this.posAttr.needsUpdate = true;
  }

  /** Sample the main channel centerline at t∈[0,1] — for the travelling pulse. */
  sampleMain(t: number, out: THREE.Vector3): THREE.Vector3 {
    return this.mainPoint(t, out);
  }

  /** Set the structural-light colour and overall opacity of the whole figure. */
  setAppearance(color: THREE.Color, opacity: number) {
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.color.copy(color);
    mat.opacity = opacity;
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
