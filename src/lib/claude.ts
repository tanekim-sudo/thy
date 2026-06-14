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

// ===================================================================
// PART 9 — THE AI LAYERS
// Interpretation (9.1) → Expansion (9.2) → Disturb (9.3) →
// Implicit Question (9.4) → Reflection (9.5). None of these write prose
// into the field; they return substrate, single words, or single questions.
// ===================================================================

export interface FragmentLite {
  id: string;
  text: string;
  opacity?: number;
  mass?: number;
  attentionCount?: number;
}

export interface InterpretResult {
  themeClusters: string[][];
  productiveTensions: [string, string][];
  circlingRegion: { ids: string[]; label: string } | null;
  driftTargets: { id: string; towardId: string }[];
}

const INTERPRET_TOOL: Anthropic.Tool = {
  name: "describe_field_shape",
  description:
    "Return structured data describing the shape of this thinking — never text for display. Substrate, not surface.",
  input_schema: {
    type: "object",
    properties: {
      theme_clusters: {
        type: "array",
        description: "Groups of fragment ids sharing conceptual territory, even if unconnected.",
        items: { type: "array", items: { type: "string" } },
      },
      productive_tensions: {
        type: "array",
        description: "Pairs of fragment ids in unresolved contradiction or tension.",
        items: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: ["a", "b"],
        },
      },
      circling_region: {
        type: "object",
        description:
          "If the thinking repeatedly returns to an unnamed area, the fragment ids at its center and a 1-3 word characterization. Internal data only.",
        properties: {
          fragment_ids: { type: "array", items: { type: "string" } },
          label: { type: "string" },
        },
      },
      drift_targets: {
        type: "array",
        description: "Per fragment, an optional weak semantic pull toward another fragment id.",
        items: {
          type: "object",
          properties: { fragment_id: { type: "string" }, toward_id: { type: "string" } },
          required: ["fragment_id", "toward_id"],
        },
      },
    },
    required: ["theme_clusters", "productive_tensions", "drift_targets"],
  },
};

const INTERPRET_SYSTEM = `You are the interpretation layer of a cognitive field. You will receive a list of fragments (raw, unedited phrases a person has spoken or written while thinking) with metadata about how much attention each has received, and the existing connections between them. Your job is NOT to summarize or respond. Your job is to return structured data describing the shape of this thinking, which will be used to silently adjust the visual field — never shown as text to the user. Never include any text intended for direct display. Everything you return is substrate, not surface.`;

export async function interpretField(
  fragments: FragmentLite[],
  connectionSummary: string
): Promise<InterpretResult | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;

  const valid = new Set(fragments.map((f) => f.id));
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    temperature: 0,
    system: INTERPRET_SYSTEM,
    tools: [INTERPRET_TOOL],
    tool_choice: { type: "tool", name: "describe_field_shape" },
    messages: [
      {
        role: "user",
        content: `FRAGMENTS (id, attention, text):
${fragments
  .map((f) => `- (${f.id}) [att=${f.attentionCount ?? 1}] ${f.text.slice(0, 200)}`)
  .join("\n")}

EXISTING CONNECTIONS:
${connectionSummary || "(none)"}

Only reference fragment ids that appear above.`,
      },
    ],
  });

  const tool = msg.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return null;
  const input = tool.input as Record<string, unknown>;

  const clusters = Array.isArray(input.theme_clusters)
    ? (input.theme_clusters as unknown[])
        .map((c) => (Array.isArray(c) ? c.map(String).filter((id) => valid.has(id)) : []))
        .filter((c) => c.length >= 2)
    : [];

  const tensions = Array.isArray(input.productive_tensions)
    ? (input.productive_tensions as Record<string, unknown>[])
        .map((p) => [String(p.a), String(p.b)] as [string, string])
        .filter(([a, b]) => valid.has(a) && valid.has(b) && a !== b)
    : [];

  let circling: { ids: string[]; label: string } | null = null;
  const cr = input.circling_region as Record<string, unknown> | undefined;
  if (cr && Array.isArray(cr.fragment_ids) && cr.label) {
    const ids = (cr.fragment_ids as unknown[]).map(String).filter((id) => valid.has(id));
    if (ids.length > 0) circling = { ids, label: String(cr.label).slice(0, 40) };
  }

  const drift = Array.isArray(input.drift_targets)
    ? (input.drift_targets as Record<string, unknown>[])
        .map((d) => ({ id: String(d.fragment_id), towardId: String(d.toward_id) }))
        .filter((d) => valid.has(d.id) && valid.has(d.towardId) && d.id !== d.towardId)
    : [];

  return { themeClusters: clusters, productiveTensions: tensions, circlingRegion: circling, driftTargets: drift };
}

async function callForShortStrings(
  system: string,
  user: string,
  toolName: string,
  prop: string,
  max = 3
): Promise<string[]> {
  const anthropic = getClaude();
  if (!anthropic) return [];
  const tool: Anthropic.Tool = {
    name: toolName,
    description: "Return only short words/phrases as structured data.",
    input_schema: {
      type: "object",
      properties: { [prop]: { type: "array", items: { type: "string" } } },
      required: [prop],
    },
  };
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    temperature: 0.6,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: user }],
  });
  const t = msg.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use") return [];
  const arr = (t.input as Record<string, unknown>)[prop];
  return Array.isArray(arr) ? arr.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max) : [];
}

/** 9.2 — Expansion: 1–3 concrete peripheral words adjacent to a cluster. */
export async function expandCluster(contents: string[]): Promise<string[]> {
  return callForShortStrings(
    CLAUDE_LAWS,
    `Given this cluster of fragments, suggest ONE to THREE single words or very short phrases (2-4 words max) that are adjacent to this conceptual territory but NOT present in it — words that, if the person noticed them, might shift or deepen their trajectory without being an answer or a suggestion. They should feel like things already nearby, not insights handed over. Avoid abstractions like "meaning" or "purpose"; favor concrete, specific words. Return only the words/phrases.

CLUSTER:
${contents.map((c) => `- ${c.slice(0, 200)}`).join("\n")}`,
    "peripheral_words",
    "words",
    3
  );
}

async function callForOneQuestion(system: string, user: string): Promise<string | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;
  const tool: Anthropic.Tool = {
    name: "return_question",
    description: "Return a single short question as structured data.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  };
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    temperature: 0.5,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: "return_question" },
    messages: [{ role: "user", content: user }],
  });
  const t = msg.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use") return null;
  const q = (t.input as Record<string, unknown>).question;
  return q ? String(q).trim() : null;
}

/** 9.3 — Disturb: one question naming an unresolved tension. */
export async function disturbPair(aText: string, bText: string): Promise<string | null> {
  return callForOneQuestion(
    CLAUDE_LAWS,
    `These two fragments are in unresolved tension:
A: "${aText.slice(0, 240)}"
B: "${bText.slice(0, 240)}"
Generate ONE short question (under 12 words) that names the tension directly, framed as a genuine question rather than a critique. Do not resolve the tension. Do not suggest which side is right. It should feel like something the person's own thinking was already gesturing toward.`
  );
}

/** 9.4 — Implicit Question: names the question the thinking is organized around. */
export async function implicitQuestion(contents: string[]): Promise<string | null> {
  return callForOneQuestion(
    CLAUDE_LAWS,
    `This person's thinking has been circling a region without naming it directly. Fragments in that region:
${contents.map((c) => `- ${c.slice(0, 200)}`).join("\n")}
In one short question (under 15 words), name the question this thinking seems to actually be organized around — not what they said, but what their saying seems to be in service of. Phrase it so they could immediately recognize it as either exactly right or completely wrong — not vague, not safe.`
  );
}

export interface ReflectionResult {
  emphasizeClusters: string[][];
  newConnections: [string, string][];
  clusterLabels: { ids: string[]; label: string }[];
}

const REFLECT_TOOL: Anthropic.Tool = {
  name: "reorganize_field",
  description: "Return a spatial reorganization of the user's own material — never a text summary.",
  input_schema: {
    type: "object",
    properties: {
      emphasize_clusters: {
        type: "array",
        items: { type: "array", items: { type: "string" } },
      },
      new_connections: {
        type: "array",
        items: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: ["a", "b"],
        },
      },
      cluster_labels: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fragment_ids: { type: "array", items: { type: "string" } },
            label: { type: "string" },
          },
          required: ["fragment_ids", "label"],
        },
      },
    },
    required: ["emphasize_clusters", "new_connections"],
  },
};

/** 9.5 — Reflection: on-demand spatial reorganization (single-word labels only). */
export async function reflect(
  fragments: FragmentLite[],
  connectionSummary: string
): Promise<ReflectionResult | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;
  const valid = new Set(fragments.map((f) => f.id));

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    temperature: 0.2,
    system: CLAUDE_LAWS,
    tools: [REFLECT_TOOL],
    tool_choice: { type: "tool", name: "reorganize_field" },
    messages: [
      {
        role: "user",
        content: `Given these fragments and connections, return a spatial reorganization (not a text summary): which clusters to emphasize, any newly-visible connections, and single-word/short-phrase labels for the 2-4 most prominent clusters (to render as huge, faint constellation names). Only reference ids below.

FRAGMENTS:
${fragments.map((f) => `- (${f.id}) ${f.text.slice(0, 160)}`).join("\n")}

CONNECTIONS:
${connectionSummary || "(none)"}`,
      },
    ],
  });

  const t = msg.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use") return null;
  const input = t.input as Record<string, unknown>;

  const emphasize = Array.isArray(input.emphasize_clusters)
    ? (input.emphasize_clusters as unknown[])
        .map((c) => (Array.isArray(c) ? c.map(String).filter((id) => valid.has(id)) : []))
        .filter((c) => c.length > 0)
    : [];
  const conns = Array.isArray(input.new_connections)
    ? (input.new_connections as Record<string, unknown>[])
        .map((p) => [String(p.a), String(p.b)] as [string, string])
        .filter(([a, b]) => valid.has(a) && valid.has(b) && a !== b)
    : [];
  const labels = Array.isArray(input.cluster_labels)
    ? (input.cluster_labels as Record<string, unknown>[])
        .map((l) => ({
          ids: Array.isArray(l.fragment_ids)
            ? (l.fragment_ids as unknown[]).map(String).filter((id) => valid.has(id))
            : [],
          label: String(l.label || "").slice(0, 40),
        }))
        .filter((l) => l.ids.length > 0 && l.label)
    : [];

  return { emphasizeClusters: emphasize, newConnections: conns, clusterLabels: labels };
}

// ===================================================================
// PART 14.7 / 15 / 17 — Tool execution, Branch, Legibility
// ===================================================================

/** 14.7 — Generic tool execution on a selection (returns short alternatives). */
export async function executeTool(instruction: string, selection: string): Promise<string[]> {
  return callForShortStrings(
    CLAUDE_LAWS,
    `You are a workbench tool in a cognitive field. The user highlighted material and invoked this instruction:
"${instruction}"

SELECTED MATERIAL:
"""${selection.slice(0, 2000)}"""

Apply the instruction to this material only. Return ONE to THREE short outputs (words or brief phrases) as structured data — never paragraphs, never suggestions about what to think next. If the instruction implies a single transformation, return one output.`,
    "tool_outputs",
    "outputs",
    3
  );
}

/** 15.1 — Branch: divergent directional seeds from one fragment. */
export async function branchSeeds(fragmentText: string): Promise<string[]> {
  return callForShortStrings(
    CLAUDE_LAWS,
    `Given this fragment: "${fragmentText.slice(0, 400)}"
Generate 3-4 short directional seeds (2-5 words each) representing genuinely different directions this idea could develop — not elaborations of the same direction, divergent paths. Each should feel like the beginning of something, not a description of where it leads.`,
    "branch_seeds",
    "seeds",
    4
  );
}

/** 15.3 — One autonomous germination tick for an unattended branch seed. */
export async function branchGerminate(seedText: string): Promise<string | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;
  const tool: Anthropic.Tool = {
    name: "branch_next",
    description: "Optional next thought if a clear next step exists.",
    input_schema: {
      type: "object",
      properties: {
        has_next: { type: "boolean" },
        next: { type: "string" },
      },
      required: ["has_next"],
    },
  };
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 120,
    temperature: 0.5,
    system: CLAUDE_LAWS,
    tools: [tool],
    tool_choice: { type: "tool", name: "branch_next" },
    messages: [
      {
        role: "user",
        content: `This is a branch-seed fragment: "${seedText.slice(0, 200)}"
If a clear natural next thought exists if this direction were followed, return it as 2-5 words. Otherwise has_next=false. Only one step — not a plan.`,
      },
    ],
  });
  const t = msg.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use") return null;
  const input = t.input as Record<string, unknown>;
  if (!input.has_next) return null;
  const next = String(input.next || "").trim();
  return next || null;
}

/** 17.3 — Legibility: transcription-only linear text from ordered fragments. */
export async function legibility(fragments: string[]): Promise<string | null> {
  const anthropic = getClaude();
  if (!anthropic) return null;
  const tool: Anthropic.Tool = {
    name: "legible_text",
    description: "Render fragments as legible linear text without adding content.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  };
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    temperature: 0,
    system: CLAUDE_LAWS,
    messages: [
      {
        role: "user",
        content: `You will receive a sequence of raw thought-fragments, in order. Your only task is to render them as legible linear text — NOT a rewrite, NOT an improvement, NOT an expansion. Preserve the person's exact words, syntax, and word choices wherever possible. Where consecutive fragments don't connect grammatically, insert a line break rather than connective prose — prefer the form of a poem (fragments as lines) over forcing prose cohesion. Resolve only obvious transcription artifacts (false starts, filler words like 'um' if they clearly aren't meant as content). Do not add any word, phrase, or idea that wasn't present in the fragments.

FRAGMENTS IN ORDER:
${fragments.map((f, i) => `${i + 1}. ${f.slice(0, 400)}`).join("\n")}`,
      },
    ],
    tools: [tool],
    tool_choice: { type: "tool", name: "legible_text" },
  });
  const t = msg.content.find((b) => b.type === "tool_use");
  if (!t || t.type !== "tool_use") return null;
  const text = (t.input as Record<string, unknown>).text;
  return text ? String(text).trim() : null;
}

/** Scoped reflection for a highlight selection (field or page). */
export async function reflectSelection(
  fragmentTexts: string[],
  connectionSummary: string
): Promise<ReflectionResult | null> {
  return reflect(
    fragmentTexts.map((text, i) => ({ id: `sel-${i}`, text })),
    connectionSummary
  );
}
