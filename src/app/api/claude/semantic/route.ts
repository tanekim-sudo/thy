import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeSemantics, getClaude } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 2 — Semantic Memory.
 * Runs after capture (post-session / idle), never during input.
 * Computes relationships for one unprocessed thought and writes them as
 * field parameters: embedding, charge, and filaments. No content is created.
 */
export async function POST(req: NextRequest) {
  const { thoughtId } = await req.json();

  if (!getClaude()) {
    return NextResponse.json({ skipped: "no_anthropic_key" });
  }

  const thought = await prisma.thought.findUnique({ where: { id: thoughtId } });
  if (!thought) return NextResponse.json({ error: "not found" }, { status: 404 });

  const corpus = await prisma.thought.findMany({
    where: { id: { not: thoughtId } },
    orderBy: { timestamp: "desc" },
    take: 50,
  });

  const prosody = thought.prosodyJson ? JSON.parse(thought.prosodyJson) : null;
  const prosodyNote = prosody
    ? `pace=${prosody.pace}, trailingOff=${prosody.trailingOff}, confidence=${prosody.confidence}`
    : "";

  let result;
  try {
    result = await computeSemantics(
      thought.rawText,
      prosodyNote,
      corpus.map((c) => ({
        id: c.id,
        text: c.rawText,
        embedding: c.embeddingJson ? JSON.parse(c.embeddingJson) : undefined,
      }))
    );
  } catch (err) {
    console.error("[claude/semantic]", err);
    return NextResponse.json({ error: "claude_failed" }, { status: 502 });
  }

  if (!result) return NextResponse.json({ skipped: "no_result" });

  await prisma.thought.update({
    where: { id: thoughtId },
    data: {
      embeddingJson: JSON.stringify(result.embedding),
      charge: result.charge,
      state: "hypha",
    },
  });

  const created: {
    id: string;
    sourceId: string;
    targetId: string;
    strength: number;
    type: string;
  }[] = [];

  const link = async (
    targetId: string,
    strength: number,
    type: "resonance" | "tension" | "echo"
  ) => {
    const existing = await prisma.filament.findFirst({
      where: {
        OR: [
          { sourceId: thoughtId, targetId },
          { sourceId: targetId, targetId: thoughtId },
        ],
      },
    });
    if (existing) {
      const f = await prisma.filament.update({
        where: { id: existing.id },
        data: { strength: Math.min(1, existing.strength + strength * 0.5), traffic: existing.traffic + 1, isActive: true },
      });
      created.push({ id: f.id, sourceId: f.sourceId, targetId: f.targetId, strength: f.strength, type: f.type });
      return;
    }
    const f = await prisma.filament.create({
      data: { sourceId: thoughtId, targetId, strength, type, traffic: 1 },
    });
    created.push({ id: f.id, sourceId: f.sourceId, targetId: f.targetId, strength: f.strength, type: f.type });
  };

  for (const r of result.resonances) if (r.strength > 0.25) await link(r.thoughtId, r.strength, "resonance");
  for (const t of result.tensions) if (t.strength > 0.25) await link(t.thoughtId, t.strength, "tension");
  for (const e of result.echoes) if (e.strength > 0.25) await link(e.thoughtId, e.strength, "echo");

  return NextResponse.json({
    thoughtId,
    embedding: result.embedding,
    charge: result.charge,
    register: result.register,
    filaments: created,
  });
}
