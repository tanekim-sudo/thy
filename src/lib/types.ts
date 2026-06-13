export type ThoughtState = "spore" | "hypha" | "fruiting";
export type ThoughtTexture = "smooth" | "rough" | "very_rough";
export type FilamentType = "resonance" | "tension" | "echo" | "temporal";

export interface Prosody {
  pace: number;
  pauses: number[];
  confidence: number;
  trailingOff: boolean;
}

export interface ThoughtNode {
  id: string;
  rawText: string;
  prosody?: Prosody;
  timestamp: number;
  returnCount: number;
  position: [number, number, number];
  velocity: [number, number, number];
  mass: number;
  luminosity: number;
  texture: ThoughtTexture;
  state: ThoughtState;
  charge: number;
  embedding?: number[];
  isSynthesis: boolean;
  sourceThoughtIds?: string[];
  /** 0–1 crystallization progress */
  crystallizing?: number;
}

export interface FilamentEdge {
  id: string;
  sourceId: string;
  targetId: string;
  strength: number;
  type: FilamentType;
  ageSessions: number;
  isActive: boolean;
  traffic: number;
  /** 0–1 growth progress for new filaments */
  growth: number;
}

export interface ThreadState {
  active: boolean;
  points: [number, number, number][];
  targetPosition: [number, number, number] | null;
  partialText: string;
}

export interface FieldSnapshot {
  nodes: ThoughtNode[];
  filaments: FilamentEdge[];
  energy: "drift" | "turbulence";
  ontologySignature: Record<string, unknown>;
}

export interface PendingAdjustment {
  brightenNodeId?: string;
  brightenAmount?: number;
  thickenFilamentId?: string;
  thickenAmount?: number;
  pullNodes?: { a: string; b: string; delta: number }[];
  durationMs: number;
}
