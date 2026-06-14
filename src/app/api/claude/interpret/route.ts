import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClaude, interpretField, branchGerminate } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 9.1 — Interpretation. Runs on an interval (every ~25s) over the field.
 * Returns the *shape* of the thinking as substrate: candidate connections,
 * tensions, semantic drift targets, and a persisted "circling region" signal
 * that eventually triggers the implicit question (9.4). Never returns prose.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  if (!getClaude()) return NextResponse.json({ skipped: "no_anthropic_key" });

  const { sessionId, pendingBranchIds } = await req.json().catch(() => ({}));

  const thoughts = await prisma.thought.findMany({
    where: sessionId ? { userId, sessionId } : { userId },
    orderBy: { timestamp: "desc" },
    take: 60,
  });
  if (thoughts.length < 3) return NextResponse.json({ skipped: "too_few" });

  const ids = new Set(thoughts.map((t) => t.id));
  const filaments = await prisma.filament.findMany({ where: { userId } });
  const relevant = filaments.filter((f) => ids.has(f.sourceId) && ids.has(f.targetId));

  let result;
  try {
    result = await interpretField(
      thoughts.map((t) => ({
        id: t.id,
        text: t.rawText,
        opacity: t.luminosity,
        mass: t.mass,
        attentionCount: t.attentionCount,
      })),
      relevant.map((f) => `- ${f.sourceId} <-${f.type}-> ${f.targetId} (${f.strength.toFixed(2)})`).join("\n")
    );
  } catch (err) {
    console.error("[claude/interpret]", err);
    return NextResponse.json({ skipped: "claude_failed" });
  }
  if (!result) return NextResponse.json({ skipped: "no_result" });

  const created: {
    id: string;
    sourceId: string;
    targetId: string;
    strength: number;
    conductionSpeed: number;
    type: string;
  }[] = [];

  const link = async (a: string, b: string, strength: number, type: string) => {
    if (a === b) return;
    const existing = filaments.find(
      (f) => (f.sourceId === a && f.targetId === b) || (f.sourceId === b && f.targetId === a)
    );
    if (existing) return; // don't strengthen user/explicit links from candidates
    const f = await prisma.filament.create({
      data: { userId, sourceId: a, targetId: b, strength, type, traffic: 0 },
    });
    filaments.push(f);
    created.push({
      id: f.id,
      sourceId: f.sourceId,
      targetId: f.targetId,
      strength: f.strength,
      conductionSpeed: f.conductionSpeed,
      type: f.type,
    });
  };

  // Theme clusters → faint candidate connections (chained, capped count).
  let budget = 12;
  for (const cluster of result.themeClusters) {
    for (let i = 0; i < cluster.length - 1 && budget > 0; i++, budget--) {
      await link(cluster[i], cluster[i + 1], 0.12, "candidate");
    }
  }
  // Productive tensions → tension connections.
  for (const [a, b] of result.productiveTensions.slice(0, 4)) {
    await link(a, b, 0.2, "tension");
  }

  // Persist circling-region across cycles so 9.4 can fire only when it sustains.
  const field = await prisma.fieldState.findUnique({ where: { userId } });
  let sig: Record<string, unknown> = {};
  try {
    sig = field?.ontologySignature ? JSON.parse(field.ontologySignature) : {};
  } catch {
    sig = {};
  }
  let circlingPersisted = false;
  if (result.circlingRegion) {
    const prev = sig.circling as { label?: string; count?: number } | undefined;
    const sameLabel =
      prev?.label &&
      result.circlingRegion.label.toLowerCase().slice(0, 12) === prev.label.toLowerCase().slice(0, 12);
    const count = sameLabel ? (prev?.count ?? 1) + 1 : 1;
    sig.circling = { label: result.circlingRegion.label, ids: result.circlingRegion.ids, count };
    circlingPersisted = count >= 2;
  } else {
    delete sig.circling;
  }
  await prisma.fieldState.upsert({
    where: { userId },
    create: { userId, ontologySignature: JSON.stringify(sig) },
    update: { ontologySignature: JSON.stringify(sig) },
  });

  // 15.3 — one autonomous germination tick per unattended branch seed.
  const germinations: { parentId: string; text: string }[] = [];
  if (Array.isArray(pendingBranchIds) && pendingBranchIds.length > 0) {
    const pending = await prisma.thought.findMany({
      where: { userId, id: { in: pendingBranchIds.map(String) }, origin: "ai_branch" },
    });
    for (const seed of pending.slice(0, 4)) {
      if (seed.attentionCount > 1) continue;
      try {
        const next = await branchGerminate(seed.rawText);
        if (next) germinations.push({ parentId: seed.id, text: next });
      } catch {
        /* skip this seed */
      }
    }
  }

  return NextResponse.json({
    filaments: created,
    driftTargets: result.driftTargets,
    themeClusters: result.themeClusters,
    productiveTensions: result.productiveTensions,
    circlingRegion: result.circlingRegion,
    circlingPersisted,
    germinations,
  });
}
