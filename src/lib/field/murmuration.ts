import type { FilamentEdge, ThoughtNode } from "@/lib/types";

export const MURMURATION_LOD_START = 0.38;
export const MURMURATION_LOD_FULL = 0.82;

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
  coherence: number;
  alignment: number;
  resolving: boolean;
  resolveUntil: number;
  murmurUntil: number;
  murmurIntensity: number;
  driftToward: [number, number] | null;
}

export interface MurmurWave {
  clusterId: string;
  until: number;
  intensity: number;
}

const COHESION = 0.00042;
const ALIGN = 0.018;
const SEPARATION = 0.0018;
const ANCHOR = 0.0032;
const MAX_SPEED = 2.8;
const AI_ALIGN_BOOST = 1.45;
const AI_SPEED_BOOST = 1.35;

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
  const base = 0.1 + avgStrength * 0.38;
  return resolving ? base + 0.14 : base;
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
    if (f.strength < 0.22) continue;
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
    if (comp.length >= 3) clusters.push(comp);
  }

  return clusters.slice(0, 8);
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
  return c ? sum / c : 0.15;
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
      const murmur = this.murmurs.find((m) => m.clusterId === id);
      return {
        id,
        memberIds,
        centroid,
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

      let avgVx = 0;
      let avgVy = 0;
      const murmurActive = cluster.murmurUntil > now;
      const murmurBoost = murmurActive ? 1 + cluster.murmurIntensity * 0.55 : 1;

      for (const node of members) {
        seenBirds.add(node.id);
        let bird = this.birds.get(node.id);
        if (!bird) {
          bird = { fragmentId: node.id, role: birdRole(node), ox: 0, oy: 0, vx: 0, vy: 0 };
          this.birds.set(node.id, bird);
        } else {
          bird.role = birdRole(node);
        }

        const roleMul = bird.role === "ai_peripheral" ? AI_SPEED_BOOST : 1;
        let fx = 0;
        let fy = 0;

        fx += (cluster.centroid[0] - (node.position[0] + bird.ox)) * COHESION;
        fy += (cluster.centroid[1] - (node.position[1] + bird.oy)) * COHESION;
        fx += cluster.avgVelocity[0] * ALIGN * (bird.role === "ai_peripheral" ? AI_ALIGN_BOOST : 1);
        fy += cluster.avgVelocity[1] * ALIGN * (bird.role === "ai_peripheral" ? AI_ALIGN_BOOST : 1);

        for (const other of members) {
          if (other.id === node.id) continue;
          const ob = this.birds.get(other.id);
          const dx = node.position[0] + bird.ox - (other.position[0] + (ob?.ox ?? 0));
          const dy = node.position[1] + bird.oy - (other.position[1] + (ob?.oy ?? 0));
          const d = Math.hypot(dx, dy) || 1;
          if (d < 55) {
            const push = SEPARATION * (1 - d / 55);
            fx += (dx / d) * push;
            fy += (dy / d) * push;
          }
        }

        fx -= bird.ox * ANCHOR;
        fy -= bird.oy * ANCHOR;

        if (cluster.driftToward) {
          fx += (cluster.driftToward[0] - cluster.centroid[0]) * 0.00008;
          fy += (cluster.driftToward[1] - cluster.centroid[1]) * 0.00008;
        }

        if (murmurActive) {
          fx += (Math.random() - 0.5) * 0.04 * cluster.murmurIntensity;
          fy += (Math.random() - 0.5) * 0.04 * cluster.murmurIntensity;
        }

        bird.vx = (bird.vx + fx * dt * roleMul * murmurBoost) * 0.9;
        bird.vy = (bird.vy + fy * dt * roleMul * murmurBoost) * 0.9;
        const sp = Math.hypot(bird.vx, bird.vy);
        const max = MAX_SPEED * roleMul * murmurBoost;
        if (sp > max) {
          bird.vx = (bird.vx / sp) * max;
          bird.vy = (bird.vy / sp) * max;
        }
        bird.ox += bird.vx * dt;
        bird.oy += bird.vy * dt;
        avgVx += bird.vx;
        avgVy += bird.vy;
      }

      avgVx /= members.length;
      avgVy /= members.length;
      cluster.avgVelocity[0] = cluster.avgVelocity[0] * 0.94 + avgVx * 0.06;
      cluster.avgVelocity[1] = cluster.avgVelocity[1] * 0.94 + avgVy * 0.06;

      let varSum = 0;
      for (const node of members) {
        const b = this.birds.get(node.id)!;
        varSum += (b.vx - avgVx) ** 2 + (b.vy - avgVy) ** 2;
      }
      const variance = varSum / (members.length * 2);
      cluster.alignment = Math.max(0, Math.min(1, 1 - variance / 1.8));

      if (cluster.alignment > 0.78 && members.length >= 3) {
        if (!cluster.resolving) {
          cluster.resolving = true;
          cluster.resolveUntil = now + 700 + Math.random() * 400;
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

  birdPositions(cluster: ClusterState, nodes: ThoughtNode[]): { x: number; y: number; role: BirdRole }[] {
    const out: { x: number; y: number; role: BirdRole }[] = [];
    for (const id of cluster.memberIds) {
      const n = nodes.find((x) => x.id === id);
      const b = this.birds.get(id);
      if (!n || !b) continue;
      out.push({ x: n.position[0] + b.ox, y: n.position[1] + b.oy, role: b.role });
    }
    return out;
  }

  buildSilhouetteContour(
    cluster: ClusterState,
    nodes: ThoughtNode[],
    cols = 28,
    rows = 22
  ): { points: Float32Array; threshold: number } | null {
    const birds = this.birdPositions(cluster, nodes);
    if (birds.length < 2) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of birds) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x);
      maxY = Math.max(maxY, b.y);
    }
    const pad = 70;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const cellW = (maxX - minX) / (cols - 1);
    const cellH = (maxY - minY) / (rows - 1);
    const grid = new Float32Array(cols * rows);
    const sigma = 1.6;

    for (const b of birds) {
      const w = b.role === "ai_peripheral" ? 0.65 : 1;
      const cx = (b.x - minX) / cellW;
      const cy = (b.y - minY) / cellH;
      const r = 3;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(rows - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(cols - 1, Math.ceil(cx + r)); x++) {
          const dx = x - cx;
          const dy = y - cy;
          grid[y * cols + x] += w * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        }
      }
    }

    const threshold = silhouetteThreshold(cluster.coherence, cluster.resolving);
    const segments: number[] = [];

    const sample = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return 0;
      return grid[y * cols + x];
    };

    const toWorld = (gx: number, gy: number) => {
      segments.push(minX + gx * cellW, minY + gy * cellH, -20);
    };

    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const v0 = sample(x, y) >= threshold ? 1 : 0;
        const v1 = sample(x + 1, y) >= threshold ? 1 : 0;
        const v2 = sample(x + 1, y + 1) >= threshold ? 1 : 0;
        const v3 = sample(x, y + 1) >= threshold ? 1 : 0;
        const idx = v0 | (v1 << 1) | (v2 << 2) | (v3 << 3);
        if (idx === 0 || idx === 15) continue;
        const mx = x + 0.5;
        const my = y + 0.5;
        if (idx === 5 || idx === 10) {
          toWorld(mx, y);
          toWorld(mx, y + 1);
        } else {
          toWorld(x, my);
          toWorld(x + 1, my);
        }
      }
    }

    if (segments.length < 6) return null;
    return { points: new Float32Array(segments), threshold };
  }
}

export function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
