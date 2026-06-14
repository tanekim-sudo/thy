import { NextRequest, NextResponse } from "next/server";
import { getClaude, branchSeeds } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 15.1 — Branch tool: divergent directional seeds. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (!getClaude()) return NextResponse.json({ seeds: [] });

  const { content } = await req.json().catch(() => ({}));
  if (!content) return NextResponse.json({ seeds: [] });

  try {
    const seeds = await branchSeeds(String(content));
    return NextResponse.json({ seeds });
  } catch (err) {
    console.error("[claude/branch]", err);
    return NextResponse.json({ seeds: [] });
  }
}
