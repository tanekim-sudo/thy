import { NextRequest, NextResponse } from "next/server";
import { getClaude, disturbPair } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Layer 9.3 — Disturb (productive tension). Returns ONE short question naming
 * a tension. The client places it as an ai_disturb fragment between A and B.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (!getClaude()) return NextResponse.json({ question: null });

  const { aText, bText } = await req.json().catch(() => ({}));
  if (!aText || !bText) return NextResponse.json({ question: null });

  try {
    const question = await disturbPair(String(aText), String(bText));
    return NextResponse.json({ question });
  } catch (err) {
    console.error("[claude/disturb]", err);
    return NextResponse.json({ question: null });
  }
}
