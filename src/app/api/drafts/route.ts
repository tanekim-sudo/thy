import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const threadId = req.nextUrl.searchParams.get("threadId");

  const drafts = await prisma.draft.findMany({
    where: threadId ? { userId, threadId } : { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    drafts: drafts.map((d) => ({
      id: d.id,
      threadId: d.threadId,
      content: d.content,
      updatedAt: d.updatedAt.getTime(),
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { id, content, deletedText, sessionId, threadId, avgPosition } = await req.json().catch(() => ({}));
  if (!id || typeof content !== "string") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const owned = await prisma.draft.findFirst({ where: { id, userId } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const draft = await prisma.draft.update({
    where: { id },
    data: { content },
  });

  // Deletions return to the field as faint fragments (17.6).
  if (deletedText && String(deletedText).trim() && sessionId) {
    const pos = avgPosition as { x?: number; y?: number } | undefined;
    await prisma.thought.create({
      data: {
        userId,
        rawText: String(deletedText).trim(),
        sessionId,
        origin: "returned_from_draft",
        luminosity: 0.15,
        mass: 0.1,
        posX: Number(pos?.x) || 0,
        posY: Number(pos?.y) || 0,
      },
    });
  }

  return NextResponse.json({
    draft: {
      id: draft.id,
      threadId: draft.threadId ?? threadId,
      content: draft.content,
      updatedAt: draft.updatedAt.getTime(),
    },
  });
}
