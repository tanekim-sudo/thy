import { NextResponse } from "next/server";
import { getClaude } from "@/lib/claude";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Runtime diagnostics — Claude, database, transcription config. */
export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  return NextResponse.json({
    ok: db && Boolean(getClaude()),
    claude: Boolean(getClaude()),
    claudeNote: getClaude()
      ? "API key present — run node scripts/test-claude.mjs to verify billing"
      : "Set ANTHROPIC_API_KEY in .env",
    claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
    database: db,
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  });
}
