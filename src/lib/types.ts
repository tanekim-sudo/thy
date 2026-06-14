export type ThoughtState = "spore" | "hypha" | "fruiting";
export type ThoughtTexture = "smooth" | "rough" | "very_rough";
export type FilamentType =
  | "resonance"
  | "tension"
  | "echo"
  | "temporal"
  | "sequence"
  | "collaboration"
  | "candidate"
  | "branch"
  | "thread";
export type FragmentOrigin =
  | "user"
  | "ai_expansion"
  | "ai_disturb"
  | "ai_implicit"
  | "ai_branch"
  | "returned_from_draft";
export type ContentType = "voice" | "type" | "sketch";

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
  crystallizing?: number;
  colorTemp?: number;
  inputVelocity?: number;
  inputAcceleration?: number;
  attentionCount?: number;
  lastAttendedAt?: number;
  origin?: FragmentOrigin;
  contentType?: ContentType;
  parentFragmentId?: string;
  sketchPath?: string;
  driftTargetId?: string;
  noDecay?: boolean;
  /** Fragment has crossed into a shaped draft (warm tint in field). */
  inDraft?: boolean;
  /** Branch seed awaiting one autonomous germination tick. */
  branchPendingGerm?: boolean;
  /** Branch graduated — no more autonomous growth. */
  branchGraduated?: boolean;
  /** Subtle hue shift for branch siblings (0–3). */
  branchHue?: number;
}

export interface NegativeMark {
  x: number;
  y: number;
  content?: string;
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
  growth: number;
  /** 18.3 — 0 = slow pulse (~1.5s), 1 = near-instant flash. */
  conductionSpeed?: number;
  /** High-water strength for pruning-vs-fading visuals (client-side default). */
  peakStrength?: number;
  /** Branch filaments pulse once on creation. */
  branchPulseAt?: number;
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

/** User workbench tool (Part 14). */
export interface UserTool {
  id: string;
  instruction: string;
  glyphPath?: string;
  mass: number;
  opacity: number;
  attentionCount: number;
  lastUsedAt: number;
  isBuiltin: boolean;
  builtinKind?: "branch" | "reflect";
}

/** Traced thread through the field (Part 17.2). */
export interface FieldThread {
  id: string;
  fragmentIds: string[];
  /** World positions for warm thread-line rendering. */
  positions: [number, number][];
}

export interface DraftDoc {
  id: string;
  threadId: string;
  content: string;
  updatedAt: number;
}

/** Selection + arrived workbench glyphs (Part 14.3 / 14.5). */
export type SelectionKind = "fragments" | "text";

export interface WorkbenchSelection {
  kind: SelectionKind;
  fragmentIds: string[];
  text?: string;
}

export interface ArrivedGlyph {
  key: string;
  toolId: string | "create" | "reflect";
  instruction: string;
  progress: number;
  /** Current screen position. */
  x: number;
  y: number;
  /** Target near selection centroid. */
  tx: number;
  ty: number;
  /** Edge it drifted in from. */
  fromX: number;
  fromY: number;
  dismissing: boolean;
  isOpen: boolean;
  isReflect: boolean;
  glyphPath?: string;
}

/** A past or live session as a single point in the cosmos view (Part 10 / 18.4). */
export interface CosmosSession {
  id: string;
  position: [number, number, number];
  mass: number;
  startedAt: number;
  isCurrent?: boolean;
}

/** Cross-session structural resonance — same mechanism as intra-session links, one level up. */
export interface CosmosResonance {
  sourceSessionId: string;
  targetSessionId: string;
  strength: number;
}
