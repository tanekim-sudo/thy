import { NextRequest, NextResponse } from "next/server";
import { getClaude, executeTool } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 14.7 — Generic tool execution on highlighted material. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (!getClaude()) return NextResponse.json({ outputs: [] });

  const { instruction, selection } = await req.json().catch(() => ({}));
  if (!instruction || !selection) return NextResponse.json({ outputs: [] });

  try {
    const outputs = await executeTool(String(instruction), String(selection));
    return NextResponse.json({ outputs });
  } catch (err) {
    console.error("[claude/execute]", err);
    return NextResponse.json({ outputs: [] });
  }
}
