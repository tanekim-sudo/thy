import { NextRequest, NextResponse } from "next/server";
import { getClaude, expandCluster } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 9.2 — Expansion ("the periphery whisper"). Returns 1–3 concrete words
 * adjacent to a cluster. The client materializes them as dim, ephemeral
 * ai_expansion fragments at the field's edge.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (!getClaude()) return NextResponse.json({ words: [] });

  const { contents } = await req.json().catch(() => ({ contents: [] }));
  if (!Array.isArray(contents) || contents.length === 0) {
    return NextResponse.json({ words: [] });
  }

  try {
    const words = await expandCluster(contents.map((c: unknown) => String(c)).slice(0, 12));
    return NextResponse.json({ words });
  } catch (err) {
    console.error("[claude/expand]", err);
    return NextResponse.json({ words: [] });
  }
}
