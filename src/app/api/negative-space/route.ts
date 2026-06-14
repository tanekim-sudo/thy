import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Faint traces of thoughts approached but never said. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const marks = await prisma.negativeSpace.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    negative: marks.map((m) => ({ x: m.posX, y: m.posY, content: m.partialContent ?? undefined })),
  });
}

/** Record an abandoned partial as negative space. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json();
  const { posX, posY, partialContent, sessionId } = body;
  if (typeof posX !== "number" || typeof posY !== "number") {
    return NextResponse.json({ error: "invalid position" }, { status: 400 });
  }

  const mark = await prisma.negativeSpace.create({
    data: {
      userId,
      posX,
      posY,
      partialContent: typeof partialContent === "string" ? partialContent.slice(0, 80) : null,
      sessionId: sessionId || null,
    },
  });

  return NextResponse.json({ id: mark.id });
}
