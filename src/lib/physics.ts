import type { FilamentEdge, ThoughtNode } from "./types";

const CENTER_REPULSION = 0.08;
const GRAVITY = 0.00015;
const DAMPING = 0.985;
const CHARGE_FORCE = 0.00002;
const SEMANTIC_PULL = 0.00004;
const VOID_RADIUS = 40;

// Boids / murmuration. Structured so a second mind's fragments can later join
// the same flock calculation and coherent collaborative motion emerges for free.
const FLOCK_RADIUS = 170;
const ALIGN_WEIGHT = 0.014; // steer toward neighbours' average heading
const SEPARATION_DIST = 26;
const SEPARATION_FORCE = 0.0016;

// Opacity-as-confidence: unattended fragments fade slowly toward a floor —
// never to nothing ("you never delete anything"). Tuned to be felt across
// long stretches, not within a normal session.
const LUM_DECAY = 0.0000006;
const LUM_FLOOR = 0.08;

// Field breathing: during silence, recent fragments drift gently together.
const BREATH_PULL = 0.0006;

// Weak pull toward an interpretation-layer semantic drift target.
const DRIFT_TARGET_PULL = 0.00018;

export interface StepOptions {
  /** Fragment ids currently "settling like sediment" during silence. */
  breathingIds?: Set<string>;
  /** Once the implicit question is attended, the center may hold content. */
  voidLifted?: boolean;
}

export function stepPhysics(
  nodes: ThoughtNode[],
  filaments: FilamentEdge[],
  energy: "drift" | "turbulence",
  dt: number,
  opts: StepOptions = {}
): ThoughtNode[] {
  const turbulence = energy === "turbulence" ? 1.8 : 1;
  const next = nodes.map((n) => ({
    ...n,
    velocity: [...n.velocity] as [number, number, number],
    position: [...n.position] as [number, number, number],
  }));

  const posById = new Map<string, [number, number, number]>();
  for (const n of next) posById.set(n.id, n.position);

  // Centroid of the breathing set (sediment settling during stillness).
  let bcx = 0;
  let bcy = 0;
  let bcz = 0;
  let bcount = 0;
  if (opts.breathingIds && opts.breathingIds.size > 0) {
    for (const n of next) {
      if (opts.breathingIds.has(n.id)) {
        bcx += n.position[0];
        bcy += n.position[1];
        bcz += n.position[2];
        bcount++;
      }
    }
    if (bcount > 0) {
      bcx /= bcount;
      bcy /= bcount;
      bcz /= bcount;
    }
  }

  for (const node of next) {
    if (node.crystallizing !== undefined && node.crystallizing < 1) continue;

    let fx = 0;
    let fy = 0;
    let fz = 0;

    const [x, y, z] = node.position;
    const distFromCenter = Math.sqrt(x * x + y * y + z * z);

    // Alexander's void — center repels. The implicit-question fragment (noDecay)
    // is exempt, and once it's attended the repulsion lifts for the session.
    if (!node.noDecay && !opts.voidLifted && distFromCenter < VOID_RADIUS && distFromCenter > 0.01) {
      const repulse = CENTER_REPULSION * (1 - distFromCenter / VOID_RADIUS);
      fx += (x / distFromCenter) * repulse;
      fy += (y / distFromCenter) * repulse;
      fz += (z / distFromCenter) * repulse;
    }

    // Boids accumulators.
    let avgVx = 0;
    let avgVy = 0;
    let avgVz = 0;
    let flockCount = 0;

    for (const other of next) {
      if (other.id === node.id) continue;
      const dx = other.position[0] - x;
      const dy = other.position[1] - y;
      const dz = other.position[2] - z;
      const distSq = dx * dx + dy * dy + dz * dz + 80;
      const dist = Math.sqrt(distSq);

      // Gravitational pull proportional to mass
      const g = (GRAVITY * other.mass * node.mass) / distSq;
      fx += (dx / dist) * g;
      fy += (dy / dist) * g;
      fz += (dz / dist) * g;

      // Charge: opposites attract, like repels
      const chargeForce = CHARGE_FORCE * node.charge * other.charge;
      if (chargeForce > 0) {
        fx -= (dx / dist) * chargeForce;
        fy -= (dy / dist) * chargeForce;
        fz -= (dz / dist) * chargeForce;
      } else {
        fx += (dx / dist) * Math.abs(chargeForce);
        fy += (dy / dist) * Math.abs(chargeForce);
        fz += (dz / dist) * Math.abs(chargeForce);
      }

      // Semantic embedding pull
      if (node.embedding && other.embedding && node.embedding.length === other.embedding.length) {
        const sim = cosineSimilarity(node.embedding, other.embedding);
        if (sim > 0.3) {
          const pull = SEMANTIC_PULL * sim * other.mass;
          fx += (dx / dist) * pull;
          fy += (dy / dist) * pull;
          fz += (dz / dist) * pull;
        } else if (sim < -0.1) {
          const push = SEMANTIC_PULL * Math.abs(sim) * 0.5;
          fx -= (dx / dist) * push;
          fy -= (dy / dist) * push;
          fz -= (dz / dist) * push;
        }
      }

      // Boids: within the flock radius, gather neighbours for alignment and
      // push apart when crowding (separation).
      if (dist < FLOCK_RADIUS) {
        avgVx += other.velocity[0];
        avgVy += other.velocity[1];
        avgVz += other.velocity[2];
        flockCount++;
        if (dist < SEPARATION_DIST) {
          const sep = SEPARATION_FORCE * (1 - dist / SEPARATION_DIST);
          fx -= (dx / dist) * sep;
          fy -= (dy / dist) * sep;
          fz -= (dz / dist) * sep;
        }
      }
    }

    // Breathing: settle toward the recent-cluster centroid during silence.
    if (bcount > 0 && opts.breathingIds!.has(node.id)) {
      fx += (bcx - x) * BREATH_PULL;
      fy += (bcy - y) * BREATH_PULL;
      fz += (bcz - z) * BREATH_PULL;
    }

    // Semantic drift toward an interpretation-layer target (very low weight).
    if (node.driftTargetId) {
      const tp = posById.get(node.driftTargetId);
      if (tp) {
        fx += (tp[0] - x) * DRIFT_TARGET_PULL;
        fy += (tp[1] - y) * DRIFT_TARGET_PULL;
        fz += (tp[2] - z) * DRIFT_TARGET_PULL;
      }
    }

    fx *= turbulence;
    fy *= turbulence;
    fz *= turbulence;

    let vx = (node.velocity[0] + fx * dt) * DAMPING;
    let vy = (node.velocity[1] + fy * dt) * DAMPING;
    let vz = (node.velocity[2] + fz * dt) * DAMPING;

    // Alignment: steer a little toward the flock's average heading.
    if (flockCount > 0) {
      avgVx /= flockCount;
      avgVy /= flockCount;
      avgVz /= flockCount;
      vx += (avgVx - vx) * ALIGN_WEIGHT * dt;
      vy += (avgVy - vy) * ALIGN_WEIGHT * dt;
      vz += (avgVz - vz) * ALIGN_WEIGHT * dt;
    }

    node.velocity[0] = vx;
    node.velocity[1] = vy;
    node.velocity[2] = vz;

    node.position[0] += vx * dt;
    node.position[1] += vy * dt;
    node.position[2] += vz * dt;

    // Confidence decays slowly toward the floor when attention doesn't return.
    // The implicit-question fragment (noDecay) holds its faint presence.
    if (!node.noDecay) {
      node.luminosity = Math.max(LUM_FLOOR, node.luminosity - LUM_DECAY * dt);
    }
  }

  // Grow filaments in background; dormant connections slowly thin.
  for (const f of filaments) {
    if (f.growth < 1) f.growth = Math.min(1, f.growth + dt * 0.08);
    if (!f.isActive) f.strength = Math.max(0.05, f.strength - dt * 0.001);
  }

  return next;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function computeSemanticPosition(
  nodes: ThoughtNode[],
  partialEmbedding?: number[]
): [number, number, number] {
  if (nodes.length === 0) {
    return [
      (Math.random() - 0.5) * 120 + 50,
      (Math.random() - 0.5) * 80,
      (Math.random() - 0.5) * 60 + 30,
    ];
  }

  if (partialEmbedding) {
    let best: ThoughtNode | null = null;
    let bestSim = -2;
    for (const n of nodes) {
      if (!n.embedding) continue;
      const sim = cosineSimilarity(partialEmbedding, n.embedding);
      if (sim > bestSim) {
        bestSim = sim;
        best = n;
      }
    }
    if (best && bestSim > 0.2) {
      return [
        best.position[0] + (Math.random() - 0.5) * 40,
        best.position[1] + (Math.random() - 0.5) * 40,
        best.position[2] + (Math.random() - 0.5) * 30 + 20,
      ];
    }
  }

  const anchor = nodes.reduce((a, b) => (a.mass > b.mass ? a : b));
  return [
    anchor.position[0] + (Math.random() - 0.5) * 100 + 60,
    anchor.position[1] + (Math.random() - 0.5) * 80,
    anchor.position[2] + (Math.random() - 0.5) * 50 + 25,
  ];
}

export function applyAdjustment(
  nodes: ThoughtNode[],
  filaments: FilamentEdge[],
  adjustment: {
    brightenNodeId?: string;
    brightenAmount?: number;
    thickenFilamentId?: string;
    thickenAmount?: number;
    pullNodes?: { a: string; b: string; delta: number }[];
  },
  progress: number
): void {
  const t = Math.min(1, progress);
  if (adjustment.brightenNodeId) {
    const node = nodes.find((n) => n.id === adjustment.brightenNodeId);
    if (node) node.luminosity = Math.min(1, node.luminosity + (adjustment.brightenAmount ?? 0.2) * t);
  }
  if (adjustment.thickenFilamentId) {
    const fil = filaments.find((f) => f.id === adjustment.thickenFilamentId);
    if (fil) fil.strength = Math.min(1, fil.strength + (adjustment.thickenAmount ?? 0.15) * t);
  }
  if (adjustment.pullNodes) {
    for (const { a, b, delta } of adjustment.pullNodes) {
      const na = nodes.find((n) => n.id === a);
      const nb = nodes.find((n) => n.id === b);
      if (!na || !nb) continue;
      const dx = nb.position[0] - na.position[0];
      const dy = nb.position[1] - na.position[1];
      const dz = nb.position[2] - na.position[2];
      const pull = delta * t * 0.02;
      na.velocity[0] += dx * pull;
      na.velocity[1] += dy * pull;
      na.velocity[2] += dz * pull;
      nb.velocity[0] -= dx * pull;
      nb.velocity[1] -= dy * pull;
      nb.velocity[2] -= dz * pull;
    }
  }
}
