import { NextRequest, NextResponse } from "next/server";
import { getClaude, implicitQuestion } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 9.4 — The Implicit Question (the center). Returns ONE short question
 * naming what the thinking is organized around. The client places it at the
 * literal center of the field — the only thing ever permitted there.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (!getClaude()) return NextResponse.json({ question: null });

  const { contents } = await req.json().catch(() => ({ contents: [] }));
  if (!Array.isArray(contents) || contents.length === 0) {
    return NextResponse.json({ question: null });
  }

  try {
    const question = await implicitQuestion(contents.map((c: unknown) => String(c)).slice(0, 16));
    return NextResponse.json({ question });
  } catch (err) {
    console.error("[claude/implicit]", err);
    return NextResponse.json({ question: null });
  }
}
