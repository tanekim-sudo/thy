import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface SnapPoint {
  x: number;
  y: number;
  mass: number;
}

/** Recent session palimpsest layers (excluding the current session). */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const current = req.nextUrl.searchParams.get("exclude");
  const sessions = await prisma.session.findMany({
    where: { userId, NOT: { fieldSnapshot: { equals: Prisma.DbNull } } },
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  const layers = sessions
    .filter((s) => s.id !== current)
    .slice(0, 8)
    .map((s) => ({ id: s.id, startedAt: s.startedAt.getTime(), points: (s.fieldSnapshot as { points?: SnapPoint[] } | null)?.points ?? [] }))
    .filter((l) => l.points.length > 0);

  return NextResponse.json({ layers });
}

/** Store the compressed final field state for cross-session palimpsest. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { sessionId, points } = await req.json().catch(() => ({}));
  if (!sessionId || !Array.isArray(points)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const clean: SnapPoint[] = points
    .slice(0, 160)
    .map((p: unknown) => {
      const o = p as Record<string, unknown>;
      return { x: Number(o.x) || 0, y: Number(o.y) || 0, mass: Number(o.mass) || 0.1 };
    });

  const snap = { points: clean } as unknown as Prisma.InputJsonValue;
  await prisma.session.upsert({
    where: { id: sessionId },
    create: { id: sessionId, userId, fieldSnapshot: snap },
    update: { fieldSnapshot: snap, endedAt: new Date() },
  });

  return NextResponse.json({ ok: true, count: clean.length });
}
