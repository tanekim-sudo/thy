import type { FilamentEdge, ThoughtNode } from "./types";

const CENTER_REPULSION = 0.08;
const GRAVITY = 0.00015;
const DAMPING = 0.985;
const CHARGE_FORCE = 0.00002;
const SEMANTIC_PULL = 0.00004;
const VOID_RADIUS = 40;

export function stepPhysics(
  nodes: ThoughtNode[],
  filaments: FilamentEdge[],
  energy: "drift" | "turbulence",
  dt: number
): ThoughtNode[] {
  const turbulence = energy === "turbulence" ? 1.8 : 1;
  const next = nodes.map((n) => ({
    ...n,
    velocity: [...n.velocity] as [number, number, number],
    position: [...n.position] as [number, number, number],
  }));

  for (const node of next) {
    if (node.crystallizing !== undefined && node.crystallizing < 1) continue;

    let fx = 0;
    let fy = 0;
    let fz = 0;

    const [x, y, z] = node.position;
    const distFromCenter = Math.sqrt(x * x + y * y + z * z);

    // Alexander's void — center repels
    if (distFromCenter < VOID_RADIUS && distFromCenter > 0.01) {
      const repulse = CENTER_REPULSION * (1 - distFromCenter / VOID_RADIUS);
      fx += (x / distFromCenter) * repulse;
      fy += (y / distFromCenter) * repulse;
      fz += (z / distFromCenter) * repulse;
    }

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
    }

    fx *= turbulence;
    fy *= turbulence;
    fz *= turbulence;

    node.velocity[0] = (node.velocity[0] + fx * dt) * DAMPING;
    node.velocity[1] = (node.velocity[1] + fy * dt) * DAMPING;
    node.velocity[2] = (node.velocity[2] + fz * dt) * DAMPING;

    node.position[0] += node.velocity[0] * dt;
    node.position[1] += node.velocity[1] * dt;
    node.position[2] += node.velocity[2] * dt;

    // Recency + mass → luminosity
    const ageDays = (Date.now() - node.timestamp) / 86400000;
    const recency = Math.exp(-ageDays / 14);
    node.luminosity = Math.min(1, 0.2 + recency * 0.4 + node.mass * 0.05 + node.returnCount * 0.03);
  }

  // Grow filaments in background
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
