import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getClaude, legibility } from "@/lib/claude";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 17.3 — Legibility pass on a completed thread. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  if (!getClaude()) return NextResponse.json({ draft: null });

  const { threadId } = await req.json().catch(() => ({}));
  if (!threadId) return NextResponse.json({ error: "threadId required" }, { status: 400 });

  const thread = await prisma.thread.findFirst({
    where: { id: threadId, userId },
    include: { fragments: { orderBy: { sequenceOrder: "asc" }, include: { fragment: true } } },
  });
  if (!thread || thread.fragments.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const texts = thread.fragments.map((tf) => tf.fragment.rawText);
  let content: string | null;
  try {
    content = await legibility(texts);
  } catch (err) {
    console.error("[claude/legibility]", err);
    return NextResponse.json({ draft: null });
  }
  if (!content) return NextResponse.json({ draft: null });

  const draft = await prisma.draft.create({
    data: { threadId, userId, content },
  });

  const ids = thread.fragments.map((tf) => tf.fragmentId);
  await prisma.thought.updateMany({
    where: { id: { in: ids }, userId },
    data: { inDraft: true },
  });

  return NextResponse.json({
    draft: {
      id: draft.id,
      threadId: draft.threadId,
      content: draft.content,
      updatedAt: draft.updatedAt.getTime(),
    },
    fragmentIds: ids,
  });
}
