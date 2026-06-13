import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude is the background intelligence of CREATE THYSELF.
 * It never writes user-visible text. It only returns structured data
 * that adjusts field physics. These laws are restated to the model on
 * every call.
 */
export const CLAUDE_LAWS = `You are the background intelligence of CREATE THYSELF. You do not speak to the user.
You do not generate thoughts. You do not suggest what to think. You do not complete sentences.
You never add content to the field. You return structured data ONLY via the provided tool.
Your job is to compute relationships and field parameters that help the user see what they
already contain. You adjust physics, not content. If asked to do anything that would add
content the user did not originate, return the smallest valid empty result.`;

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

let client: Anthropic | null = null;

export function getClaude(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface CorpusEntry {
  id: string;
  text: string;
  embedding?: number[];
}

export interface SemanticResult {
  embedding: number[];
  register: string;
  charge: number;
  suggestedPosition?: [number, number, number];
  resonances: { thoughtId: string; strength: number }[];
  tensions: { thoughtId: string; strength: number }[];
  echoes: { thoughtId: string; strength: number }[];
}

const SEMANTIC_TOOL: Anthropic.Tool = {
  name: "compute_semantic_relationships",
  description:
    "Return the conceptual position and relationships of a new thought relative to the existing corpus. Structured data only — never prose, never suggestions.",
  input_schema: {
    type: "object",
    properties: {
      embedding_vector: {
        type: "array",
        items: { type: "number" },
        description:
          "A 64-length semantic embedding of the new thought in conceptual space. Components in [-1, 1]. Deterministic for the same text.",
      },
      register: {
        type: "string",
        enum: ["reflective", "analytical", "emotional", "fragment", "synthesis"],
      },
      charge: {
        type: "number",
        description:
          "Overall charge of the thought from -1 (tension/contradiction-laden) to 1 (resonant/affirming).",
      },
      resonances: {
        type: "array",
        items: {
          type: "object",
          properties: {
            thought_id: { type: "string" },
            strength: { type: "number", description: "0 to 1" },
          },
          required: ["thought_id", "strength"],
        },
      },
      tensions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            thought_id: { type: "string" },
            strength: { type: "number", description: "0 to 1" },
          },
          required: ["thought_id", "strength"],
        },
      },
      echoes: {
        type: "array",
        description:
          "Same structural pattern appearing across a different domain of the user's thinking.",
        items: {
          type: "object",
          properties: {
            thought_id: { type: "string" },
            strength: { type: "number", description: "0 to 1" },
          },
          required: ["thought_id", "strength"],
        },
      },
    },
    required: ["embedding_vector", "register", "charge", "resonances", "tensions", "echoes"],
  },
};

export async function computeSemantics(
  thoughtText: string,
  prosodyNote: string,
  corpus: CorpusEntry[]
): Promise<SemanticResult | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;

  const corpusSummary = corpus
    .slice(0, 50)
    .map((c) => `- (${c.id}) ${c.text.slice(0, 240)}`)
    .join("\n");

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    temperature: 0,
    system: CLAUDE_LAWS,
    tools: [SEMANTIC_TOOL],
    tool_choice: { type: "tool", name: "compute_semantic_relationships" },
    messages: [
      {
        role: "user",
        content: `NEW THOUGHT (raw, uncleaned):
"""${thoughtText}"""
${prosodyNote ? `Prosody: ${prosodyNote}` : ""}

EXISTING CORPUS (id, text):
${corpusSummary || "(empty — this is the first thought)"}

Compute the embedding and relationships. Only reference thought_ids that appear in the corpus above.`,
      },
    ],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;
  const input = tool.input as Record<string, unknown>;

  const valid = new Set(corpus.map((c) => c.id));
  const clean = (arr: unknown): { thoughtId: string; strength: number }[] =>
    Array.isArray(arr)
      ? arr
          .map((r) => {
            const o = r as Record<string, unknown>;
            return { thoughtId: String(o.thought_id), strength: Number(o.strength) || 0 };
          })
          .filter((r) => valid.has(r.thoughtId))
      : [];

  return {
    embedding: Array.isArray(input.embedding_vector)
      ? (input.embedding_vector as number[]).map(Number)
      : [],
    register: String(input.register || "reflective"),
    charge: Math.max(-1, Math.min(1, Number(input.charge) || 0)),
    resonances: clean(input.resonances),
    tensions: clean(input.tensions),
    echoes: clean(input.echoes),
  };
}

export interface SurfaceAdjustment {
  brightenNodeId?: string;
  brightenAmount?: number;
  thickenFilamentId?: string;
  thickenAmount?: number;
  pullNodes?: { a: string; b: string; delta: number }[];
  durationMs: number;
}

const SURFACE_TOOL: Anthropic.Tool = {
  name: "surface_field_adjustment",
  description:
    "During a stillness period, return the single highest-value field adjustment that helps the user see a connection they already contain — or null if nothing crosses the threshold. Never text.",
  input_schema: {
    type: "object",
    properties: {
      has_adjustment: { type: "boolean" },
      brighten_node_id: { type: "string" },
      brighten_amount: { type: "number", description: "0 to 0.4" },
      thicken_filament_id: { type: "string" },
      thicken_amount: { type: "number", description: "0 to 0.4" },
      pull_nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            a: { type: "string" },
            b: { type: "string" },
            delta: { type: "number", description: "0 to 1" },
          },
          required: ["a", "b", "delta"],
        },
      },
    },
    required: ["has_adjustment"],
  },
};

export async function surfaceAdjustment(
  sessionThoughts: CorpusEntry[],
  filamentSummary: string,
  ontologySignature: string
): Promise<SurfaceAdjustment | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    temperature: 0,
    system: CLAUDE_LAWS,
    tools: [SURFACE_TOOL],
    tool_choice: { type: "tool", name: "surface_field_adjustment" },
    messages: [
      {
        role: "user",
        content: `The user has been still for 90 seconds. Identify at most ONE thing worth surfacing —
a connection that crossed a threshold, a cluster reaching critical mass, or a sustained tension.
Most stillness periods deserve no adjustment: prefer has_adjustment=false unless something is genuinely present.

SESSION THOUGHTS (id, text):
${sessionThoughts.map((t) => `- (${t.id}) ${t.text.slice(0, 200)}`).join("\n")}

FILAMENTS:
${filamentSummary}

ONTOLOGY SIGNATURE:
${ontologySignature}`,
      },
    ],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;
  const input = tool.input as Record<string, unknown>;
  if (!input.has_adjustment) return null;

  return {
    brightenNodeId: input.brighten_node_id ? String(input.brighten_node_id) : undefined,
    brightenAmount: input.brighten_amount ? Number(input.brighten_amount) : undefined,
    thickenFilamentId: input.thicken_filament_id ? String(input.thicken_filament_id) : undefined,
    thickenAmount: input.thicken_amount ? Number(input.thicken_amount) : undefined,
    pullNodes: Array.isArray(input.pull_nodes)
      ? (input.pull_nodes as Record<string, unknown>[]).map((p) => ({
          a: String(p.a),
          b: String(p.b),
          delta: Number(p.delta) || 0,
        }))
      : undefined,
    durationMs: 45000,
  };
}
