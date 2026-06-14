import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  const threads = await prisma.thread.findMany({
    where: sessionId ? { userId, sessionId } : { userId },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      fragments: { orderBy: { sequenceOrder: "asc" }, include: { fragment: true } },
    },
  });

  return NextResponse.json({
    threads: threads.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      fragmentIds: t.fragments.map((f) => f.fragmentId),
      positions: t.fragments.map((f) => [f.fragment.posX, f.fragment.posY] as [number, number]),
      createdAt: t.createdAt.getTime(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { sessionId, fragmentIds, extendThreadId } = await req.json().catch(() => ({}));
  if (!sessionId || !Array.isArray(fragmentIds) || fragmentIds.length === 0) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  let threadId = extendThreadId as string | undefined;
  let startOrder = 0;

  if (threadId) {
    const existing = await prisma.thread.findFirst({
      where: { id: threadId, userId },
      include: { fragments: true },
    });
    if (!existing) return NextResponse.json({ error: "thread not found" }, { status: 404 });
    startOrder = existing.fragments.length;
  } else {
    const thread = await prisma.thread.create({ data: { sessionId, userId } });
    threadId = thread.id;
  }

  const unique = fragmentIds.map(String).filter((id, i, a) => a.indexOf(id) === i);
  await prisma.threadFragment.createMany({
    data: unique.map((fragmentId, i) => ({
      threadId: threadId!,
      fragmentId,
      sequenceOrder: startOrder + i,
    })),
    skipDuplicates: true,
  });

  const thoughts = await prisma.thought.findMany({
    where: { id: { in: unique }, userId },
  });

  return NextResponse.json({
    thread: {
      id: threadId,
      fragmentIds: unique,
      positions: thoughts.map((t) => [t.posX, t.posY] as [number, number]),
    },
  });
}
