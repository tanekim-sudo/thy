import type { CosmosResonance, CosmosSession } from "@/lib/types";

export const COSMOS_FILAMENT_OPACITY = 0.18;
/** LOD at which inter-session filaments and session points begin to appear. */
export const COSMOS_LOD_START = 0.48;

interface SnapPoint {
  x: number;
  y: number;
  mass: number;
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

export function centroidFromPoints(
  points: SnapPoint[]
): { x: number; y: number; mass: number } | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let mass = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    mass += p.mass;
  }
  return { x: x / points.length, y: y / points.length, mass };
}

export function cosmosLinkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Gap 5 — resonance across time. Finds structurally similar fragments in
 * different sessions and returns inter-session links weighted by best similarity.
 */
export function computeCrossSessionResonances(
  bySession: Map<string, { id: string; embedding: number[] }[]>,
  minSim = 0.34
): CosmosResonance[] {
  const ids = [...bySession.keys()];
  const links: CosmosResonance[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const aId = ids[i];
      const bId = ids[j];
      const aFrags = bySession.get(aId) ?? [];
      const bFrags = bySession.get(bId) ?? [];
      let best = 0;
      for (const fa of aFrags) {
        for (const fb of bFrags) {
          if (fa.embedding.length !== fb.embedding.length) continue;
          best = Math.max(best, cosineSimilarity(fa.embedding, fb.embedding));
        }
      }
      if (best >= minSim) {
        links.push({ sourceSessionId: aId, targetSessionId: bId, strength: best });
      }
    }
  }
  return links;
}

/** Smooth fade-in for cosmos-only visuals as the camera pulls back. */
export function cosmosVisibility(lod: number): number {
  if (lod <= COSMOS_LOD_START) return 0;
  return Math.min(1, (lod - COSMOS_LOD_START) / (1 - COSMOS_LOD_START));
}

export function liveSessionCentroid(
  nodes: { position: [number, number, number]; mass: number }[]
): CosmosSession | null {
  if (nodes.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  let mass = 0;
  for (const n of nodes) {
    x += n.position[0];
    y += n.position[1];
    z += n.position[2];
    mass += n.mass;
  }
  const c = nodes.length;
  return {
    id: "__current__",
    position: [x / c, y / c, z / c],
    mass: mass / c,
    startedAt: Date.now(),
    isCurrent: true,
  };
}
