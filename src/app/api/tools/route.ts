import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { glyphFromInstruction, serializeGlyph } from "@/lib/field/glyphs";

export const dynamic = "force-dynamic";

const BRANCH_INSTRUCTION =
  "Show me three or four different directions this could go — not continuations, divergent directions, each just a few words, like seeds.";

async function ensureBuiltins(userId: string) {
  const existing = await prisma.tool.findMany({ where: { userId, isBuiltin: true } });
  const kinds = new Set(existing.map((t) => t.builtinKind));
  const toCreate: { builtinKind: string; instruction: string }[] = [];
  if (!kinds.has("branch")) toCreate.push({ builtinKind: "branch", instruction: BRANCH_INSTRUCTION });
  if (!kinds.has("reflect")) {
    toCreate.push({
      builtinKind: "reflect",
      instruction: "Show me the shape of this — spatial reorganization, not a summary.",
    });
  }
  for (const b of toCreate) {
    await prisma.tool.create({
      data: {
        userId,
        instruction: b.instruction,
        glyphPath: serializeGlyph(glyphFromInstruction(b.instruction)),
        isBuiltin: true,
        builtinKind: b.builtinKind,
        mass: 1.2,
        opacity: 0.7,
      },
    });
  }
}

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  await ensureBuiltins(userId);
  const tools = await prisma.tool.findMany({
    where: { userId },
    orderBy: [{ mass: "desc" }, { lastUsedAt: "desc" }],
  });
  return NextResponse.json({
    tools: tools.map((t) => ({
      id: t.id,
      instruction: t.instruction,
      glyphPath: t.glyphPath ?? undefined,
      mass: t.mass,
      opacity: t.opacity,
      attentionCount: t.attentionCount,
      lastUsedAt: t.lastUsedAt.getTime(),
      isBuiltin: t.isBuiltin,
      builtinKind: t.builtinKind ?? undefined,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { instruction } = await req.json().catch(() => ({}));
  const text = String(instruction || "").trim();
  if (!text) return NextResponse.json({ error: "instruction required" }, { status: 400 });

  const glyphPath = serializeGlyph(glyphFromInstruction(text));
  const tool = await prisma.tool.create({
    data: { userId, instruction: text, glyphPath, mass: 0.6, opacity: 0.6 },
  });
  return NextResponse.json({
    tool: {
      id: tool.id,
      instruction: tool.instruction,
      glyphPath: tool.glyphPath ?? undefined,
      mass: tool.mass,
      opacity: tool.opacity,
      attentionCount: tool.attentionCount,
      lastUsedAt: tool.lastUsedAt.getTime(),
      isBuiltin: false,
    },
  });
}
