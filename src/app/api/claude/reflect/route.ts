import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClaude, reflect } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 9.5 — Reflection (on-demand). Returns a spatial reorganization of the
 * user's own material: clusters to emphasize, newly-visible connections, and
 * single-word cluster labels. Never new text content beyond the labels.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  if (!getClaude()) return NextResponse.json({ reflection: null });

  const { sessionId, fragmentIds } = await req.json().catch(() => ({}));

  let thoughts = await prisma.thought.findMany({
    where: sessionId ? { userId, sessionId } : { userId },
    orderBy: { timestamp: "desc" },
    take: 60,
  });
  if (Array.isArray(fragmentIds) && fragmentIds.length > 0) {
    const allow = new Set(fragmentIds.map(String));
    thoughts = thoughts.filter((t) => allow.has(t.id));
  }
  if (thoughts.length < 1) return NextResponse.json({ reflection: null });

  const ids = new Set(thoughts.map((t) => t.id));
  const filaments = await prisma.filament.findMany({ where: { userId } });
  const relevant = filaments.filter((f) => ids.has(f.sourceId) && ids.has(f.targetId));

  try {
    const reflection = await reflect(
      thoughts.map((t) => ({ id: t.id, text: t.rawText })),
      relevant.map((f) => `- ${f.sourceId} <-${f.type}-> ${f.targetId} (${f.strength.toFixed(2)})`).join("\n")
    );
    return NextResponse.json({ reflection });
  } catch (err) {
    console.error("[claude/reflect]", err);
    return NextResponse.json({ reflection: null });
  }
}
