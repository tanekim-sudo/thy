import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClaude, surfaceAdjustment } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 4 — Surfacing.
 * Called only after 90s of stillness. Returns at most one field adjustment,
 * or null. The adjustment is applied gradually by client physics over ~45s.
 * Never returns text. Most calls should return null.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { sessionId } = await req.json();

  if (!getClaude()) {
    return NextResponse.json({ adjustment: null, skipped: "no_anthropic_key" });
  }

  const sessionThoughts = await prisma.thought.findMany({
    where: sessionId ? { sessionId, userId } : { userId },
    orderBy: { timestamp: "desc" },
    take: 40,
  });
  if (sessionThoughts.length < 2) return NextResponse.json({ adjustment: null });

  const ids = new Set(sessionThoughts.map((t) => t.id));
  const filaments = await prisma.filament.findMany({ where: { userId } });
  const relevant = filaments.filter((f) => ids.has(f.sourceId) || ids.has(f.targetId));

  const field = await prisma.fieldState.findUnique({ where: { userId } });

  let adjustment;
  try {
    adjustment = await surfaceAdjustment(
      sessionThoughts.map((t) => ({ id: t.id, text: t.rawText })),
      relevant
        .map((f) => `- (${f.id}) ${f.sourceId} <-${f.type}-> ${f.targetId} strength=${f.strength.toFixed(2)}`)
        .join("\n") || "(none)",
      field?.ontologySignature || "{}"
    );
  } catch (err) {
    console.error("[claude/surface]", err);
    return NextResponse.json({ adjustment: null });
  }

  return NextResponse.json({ adjustment });
}
