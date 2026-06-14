import type { FilamentEdge, ThoughtNode } from "@/lib/types";
import {
  buildMetaballGrid,
  marchingSquaresContour,
  rasterizeMetaballFill,
  type MetaballPoint,
} from "@/lib/field/metaball";

export const MURMURATION_LOD_START = 0.32;
export const MURMURATION_LOD_FULL = 0.78;

export type BirdRole = "user" | "ai_peripheral";

export interface FlockBird {
  fragmentId: string;
  role: BirdRole;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
}

export interface ClusterState {
  id: string;
  memberIds: string[];
  centroid: [number, number];
  avgVelocity: [number, number];
  spread: number;
  coherence: number;
  alignment: number;
  resolving: boolean;
  resolveUntil: number;
  murmurUntil: number;
  murmurIntensity: number;
  driftToward: [number, number] | null;
}

export interface ClusterVisualData {
  contour: Float32Array;
  fillCanvas: HTMLCanvasElement;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  threshold: number;
}

export interface MurmurWave {
  clusterId: string;
  until: number;
  intensity: number;
}

const COHESION = 0.0011;
const ALIGN = 0.042;
const SEPARATION = 0.0048;
const ANCHOR = 0.008;
const MAX_SPEED = 5.5;
const AI_ALIGN_BOOST = 1.55;
const AI_SPEED_BOOST = 1.5;
const WANDER = 0.018;

function birdRole(node: ThoughtNode): BirdRole {
  if (
    node.origin === "ai_expansion" ||
    node.origin === "ai_disturb" ||
    node.origin === "ai_branch" ||
    node.origin === "ai_implicit"
  ) {
    if ((node.attentionCount ?? 1) <= 1 && node.luminosity < 0.45) return "ai_peripheral";
  }
  return "user";
}

export function murmurationVisibility(lod: number): number {
  if (lod <= MURMURATION_LOD_START) return 0;
  if (lod >= MURMURATION_LOD_FULL) return 1;
  return (lod - MURMURATION_LOD_START) / (MURMURATION_LOD_FULL - MURMURATION_LOD_START);
}

export function silhouetteThreshold(avgStrength: number, resolving: boolean): number {
  const norm = avgStrength * 0.55 + 0.08;
  const base = norm * 0.42;
  return resolving ? base + 0.12 : base;
}

export function detectClusters(
  nodes: ThoughtNode[],
  filaments: FilamentEdge[],
  themeClusters: string[][],
  minSize = 2
): string[][] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const clusters: string[][] = [];
  const assigned = new Set<string>();

  for (const tc of themeClusters) {
    const members = tc.filter((id) => nodeIds.has(id));
    if (members.length >= minSize) {
      clusters.push(members);
      members.forEach((id) => assigned.add(id));
    }
  }

  const adj = new Map<string, Set<string>>();
  for (const f of filaments) {
    if (f.strength < 0.18) continue;
    if (!nodeIds.has(f.sourceId) || !nodeIds.has(f.targetId)) continue;
    if (!adj.has(f.sourceId)) adj.set(f.sourceId, new Set());
    if (!adj.has(f.targetId)) adj.set(f.targetId, new Set());
    adj.get(f.sourceId)!.add(f.targetId);
    adj.get(f.targetId)!.add(f.sourceId);
  }

  for (const startId of nodeIds) {
    if (assigned.has(startId)) continue;
    const stack = [startId];
    const comp: string[] = [];
    assigned.add(startId);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const nb of adj.get(id) ?? []) {
        if (!assigned.has(nb)) {
          assigned.add(nb);
          stack.push(nb);
        }
      }
    }
    if (comp.length >= minSize) clusters.push(comp);
  }

  // Proximity fallback — fragments near each other with no filament yet.
  for (const n of nodes) {
    if (assigned.has(n.id)) continue;
    const near = nodes.filter(
      (o) =>
        o.id !== n.id &&
        !assigned.has(o.id) &&
        Math.hypot(o.position[0] - n.position[0], o.position[1] - n.position[1]) < 140
    );
    if (near.length >= 1) {
      const group = [n.id, near[0].id];
      clusters.push(group);
      group.forEach((id) => assigned.add(id));
    }
  }

  return clusters.slice(0, 10);
}

function avgInternalStrength(memberIds: string[], filaments: FilamentEdge[]): number {
  const set = new Set(memberIds);
  let sum = 0;
  let c = 0;
  for (const f of filaments) {
    if (!set.has(f.sourceId) || !set.has(f.targetId)) continue;
    sum += f.strength;
    c++;
  }
  return c ? sum / c : 0.12;
}

function clusterSpread(memberIds: string[], nodes: ThoughtNode[]): number {
  let cx = 0;
  let cy = 0;
  for (const id of memberIds) {
    const n = nodes.find((x) => x.id === id);
    if (n) {
      cx += n.position[0];
      cy += n.position[1];
    }
  }
  cx /= memberIds.length;
  cy /= memberIds.length;
  let maxD = 40;
  for (const id of memberIds) {
    const n = nodes.find((x) => x.id === id);
    if (n) maxD = Math.max(maxD, Math.hypot(n.position[0] - cx, n.position[1] - cy));
  }
  return maxD;
}

function clusterDriftTarget(
  memberIds: string[],
  nodes: ThoughtNode[],
  allClusters: string[][]
): [number, number] | null {
  const set = new Set(memberIds);
  const targets = new Map<string, number>();
  for (const id of memberIds) {
    const n = nodes.find((x) => x.id === id);
    if (!n?.driftTargetId) continue;
    targets.set(n.driftTargetId, (targets.get(n.driftTargetId) ?? 0) + 1);
  }
  for (const other of allClusters) {
    if (other === memberIds) continue;
    if (other.some((id) => targets.has(id))) {
      let cx = 0;
      let cy = 0;
      for (const id of other) {
        const n = nodes.find((x) => x.id === id);
        if (n) {
          cx += n.position[0];
          cy += n.position[1];
        }
      }
      return [cx / other.length, cy / other.length];
    }
  }
  const best = [...targets.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || set.has(best[0])) return null;
  const tn = nodes.find((x) => x.id === best[0]);
  return tn ? [tn.position[0], tn.position[1]] : null;
}

export class MurmurationField {
  clusters: ClusterState[] = [];
  birds = new Map<string, FlockBird>();
  murmurs: MurmurWave[] = [];

  triggerMurmur(clusterId: string, durationMs = 1800, intensity = 1) {
    this.murmurs.push({ clusterId, until: performance.now() + durationMs, intensity });
    const cl = this.clusters.find((c) => c.id === clusterId);
    if (cl) {
      cl.murmurUntil = performance.now() + durationMs;
      cl.murmurIntensity = intensity;
    }
  }

  triggerMurmurForMembers(memberIds: string[]) {
    const id = memberIds.slice().sort().join(",");
    this.triggerMurmur(id, 1800, 1);
    for (const cid of memberIds) {
      for (const cl of this.clusters) {
        if (cl.memberIds.includes(cid)) {
          cl.murmurUntil = performance.now() + 1800;
          cl.murmurIntensity = 1;
        }
      }
    }
  }

  update(
    nodes: ThoughtNode[],
    filaments: FilamentEdge[],
    themeClusters: string[][],
    dt: number,
    now: number
  ) {
    this.murmurs = this.murmurs.filter((m) => m.until > now);
    const rawClusters = detectClusters(nodes, filaments, themeClusters);
    const prev = new Map(this.clusters.map((c) => [c.id, c]));

    this.clusters = rawClusters.map((memberIds) => {
      const id = memberIds.slice().sort().join(",");
      const old = prev.get(id);
      let cx = 0;
      let cy = 0;
      let c = 0;
      for (const mid of memberIds) {
        const n = nodes.find((x) => x.id === mid);
        if (n) {
          cx += n.position[0];
          cy += n.position[1];
          c++;
        }
      }
      const centroid: [number, number] = c ? [cx / c, cy / c] : [0, 0];
      const coherence = avgInternalStrength(memberIds, filaments);
      const spread = clusterSpread(memberIds, nodes);
      const murmur = this.murmurs.find((m) => m.clusterId === id);
      return {
        id,
        memberIds,
        centroid,
        spread,
        avgVelocity: old?.avgVelocity ?? [0, 0],
        coherence,
        alignment: old?.alignment ?? 0,
        resolving: old?.resolving ?? false,
        resolveUntil: old?.resolveUntil ?? 0,
        murmurUntil: murmur?.until ?? old?.murmurUntil ?? 0,
        murmurIntensity: murmur?.intensity ?? old?.murmurIntensity ?? 0,
        driftToward: clusterDriftTarget(memberIds, nodes, rawClusters),
      };
    });

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const seenBirds = new Set<string>();

    for (const cluster of this.clusters) {
      const members = cluster.memberIds
        .map((id) => nodeById.get(id))
        .filter((n): n is ThoughtNode => Boolean(n));
      if (members.length === 0) continue;

      const sepR = Math.max(35, cluster.spread * 0.55);
      const maxOff = Math.max(28, cluster.spread * 0.85);
      let avgVx = 0;
      let avgVy = 0;
      const murmurActive = cluster.murmurUntil > now;
      const murmurBoost = murmurActive ? 1 + cluster.murmurIntensity * 0.85 : 1;
      const wanderPhase = now * 0.001 + cluster.id.length;

      for (const node of members) {
        seenBirds.add(node.id);
        let bird = this.birds.get(node.id);
        if (!bird) {
          bird = {
            fragmentId: node.id,
            role: birdRole(node),
            ox: (Math.random() - 0.5) * 8,
            oy: (Math.random() - 0.5) * 8,
            vx: 0,
            vy: 0,
          };
          this.birds.set(node.id, bird);
        } else {
          bird.role = birdRole(node);
        }

        const roleMul = bird.role === "ai_peripheral" ? AI_SPEED_BOOST : 1;
        let fx = 0;
        let fy = 0;
        const px = node.position[0] + bird.ox;
        const py = node.position[1] + bird.oy;

        fx += (cluster.centroid[0] - px) * COHESION;
        fy += (cluster.centroid[1] - py) * COHESION;
        fx += cluster.avgVelocity[0] * ALIGN * (bird.role === "ai_peripheral" ? AI_ALIGN_BOOST : 1);
        fy += cluster.avgVelocity[1] * ALIGN * (bird.role === "ai_peripheral" ? AI_ALIGN_BOOST : 1);

        for (const other of members) {
          if (other.id === node.id) continue;
          const ob = this.birds.get(other.id);
          const dx = px - (other.position[0] + (ob?.ox ?? 0));
          const dy = py - (other.position[1] + (ob?.oy ?? 0));
          const d = Math.hypot(dx, dy) || 1;
          if (d < sepR) {
            const push = SEPARATION * (1 - d / sepR);
            fx += (dx / d) * push;
            fy += (dy / d) * push;
          }
        }

        fx -= bird.ox * ANCHOR;
        fy -= bird.oy * ANCHOR;

        if (cluster.driftToward) {
          fx += (cluster.driftToward[0] - cluster.centroid[0]) * 0.00022;
          fy += (cluster.driftToward[1] - cluster.centroid[1]) * 0.00022;
        }

        fx += Math.sin(wanderPhase + node.position[0] * 0.02) * WANDER;
        fy += Math.cos(wanderPhase * 1.3 + node.position[1] * 0.02) * WANDER;

        if (murmurActive) {
          fx += (Math.random() - 0.5) * 0.12 * cluster.murmurIntensity;
          fy += (Math.random() - 0.5) * 0.12 * cluster.murmurIntensity;
        }

        bird.vx = (bird.vx + fx * dt * roleMul * murmurBoost) * 0.88;
        bird.vy = (bird.vy + fy * dt * roleMul * murmurBoost) * 0.88;
        const sp = Math.hypot(bird.vx, bird.vy);
        const max = MAX_SPEED * roleMul * murmurBoost;
        if (sp > max) {
          bird.vx = (bird.vx / sp) * max;
          bird.vy = (bird.vy / sp) * max;
        }
        bird.ox += bird.vx * dt;
        bird.oy += bird.vy * dt;
        bird.ox = Math.max(-maxOff, Math.min(maxOff, bird.ox));
        bird.oy = Math.max(-maxOff, Math.min(maxOff, bird.oy));
        avgVx += bird.vx;
        avgVy += bird.vy;
      }

      avgVx /= members.length;
      avgVy /= members.length;
      cluster.avgVelocity[0] = cluster.avgVelocity[0] * 0.92 + avgVx * 0.08;
      cluster.avgVelocity[1] = cluster.avgVelocity[1] * 0.92 + avgVy * 0.08;

      let varSum = 0;
      for (const node of members) {
        const b = this.birds.get(node.id)!;
        varSum += (b.vx - avgVx) ** 2 + (b.vy - avgVy) ** 2;
      }
      const variance = varSum / (members.length * 2);
      cluster.alignment = Math.max(0, Math.min(1, 1 - variance / 2.4));

      if (cluster.alignment > 0.72 && members.length >= 2) {
        if (!cluster.resolving) {
          cluster.resolving = true;
          cluster.resolveUntil = now + 600 + Math.random() * 500;
        }
      }
      if (cluster.resolving && now > cluster.resolveUntil) {
        cluster.resolving = false;
      }
    }

    for (const id of this.birds.keys()) {
      if (!seenBirds.has(id)) this.birds.delete(id);
    }
  }

  birdPositions(
    cluster: ClusterState,
    nodes: ThoughtNode[]
  ): { x: number; y: number; role: BirdRole; weight: number }[] {
    const out: { x: number; y: number; role: BirdRole; weight: number }[] = [];
    for (const id of cluster.memberIds) {
      const n = nodes.find((x) => x.id === id);
      const b = this.birds.get(id);
      if (!n || !b) continue;
      const w =
        b.role === "ai_peripheral"
          ? 0.55 + n.luminosity * 0.25
          : 0.75 + Math.sqrt(n.mass) * 0.2 + n.luminosity * 0.15;
      out.push({
        x: n.position[0] + b.ox,
        y: n.position[1] + b.oy,
        role: b.role,
        weight: w,
      });
    }
    return out;
  }

  buildClusterVisual(cluster: ClusterState, nodes: ThoughtNode[]): ClusterVisualData | null {
    const birds = this.birdPositions(cluster, nodes);
    if (birds.length < 2) return null;

    const points: MetaballPoint[] = birds.map((b) => ({ x: b.x, y: b.y, weight: b.weight }));
    const grid = buildMetaballGrid(points, 44, 32, 90, 2.4);
    if (!grid) return null;

    const threshold = silhouetteThreshold(cluster.coherence, cluster.resolving) * grid.maxVal;
    const contour = marchingSquaresContour(grid, threshold);
    const { canvas: fillCanvas } = rasterizeMetaballFill(grid, threshold, 0.42);

    return {
      contour,
      fillCanvas,
      bounds: {
        minX: grid.minX,
        minY: grid.minY,
        maxX: grid.minX + grid.cellW * (grid.cols - 1),
        maxY: grid.minY + grid.cellH * (grid.rows - 1),
      },
      threshold,
    };
  }
}

export function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
