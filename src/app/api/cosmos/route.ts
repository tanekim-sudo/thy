import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  centroidFromPoints,
  computeCrossSessionResonances,
} from "@/lib/field/cosmos";

export const dynamic = "force-dynamic";

interface SnapPoint {
  x: number;
  y: number;
  mass: number;
}

/**
 * Part 10 / 18.4 — Cosmos view data: sessions as cluster points and
 * cross-session resonance links (Gap 5) for the cosmic-web filaments.
 */
export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const currentSessionId = req.nextUrl.searchParams.get("current") ?? undefined;

  const [sessions, thoughts] = await Promise.all([
    prisma.session.findMany({
      where: { userId, NOT: { fieldSnapshot: { equals: Prisma.DbNull } } },
      orderBy: { startedAt: "desc" },
      take: 12,
    }),
    prisma.thought.findMany({
      where: {
        userId,
        sessionId: { not: null },
        embeddingJson: { not: null },
        origin: "user",
      },
      select: { id: true, sessionId: true, embeddingJson: true },
      take: 400,
    }),
  ]);

  const cosmosSessions: {
    id: string;
    position: [number, number, number];
    mass: number;
    startedAt: number;
    isCurrent?: boolean;
  }[] = [];

  for (const s of sessions) {
    if (s.id === currentSessionId) continue;
    const points = (s.fieldSnapshot as { points?: SnapPoint[] } | null)?.points ?? [];
    const c = centroidFromPoints(points);
    if (!c) continue;
    cosmosSessions.push({
      id: s.id,
      position: [c.x, c.y, -60 - cosmosSessions.length * 18],
      mass: c.mass / Math.max(1, points.length),
      startedAt: s.startedAt.getTime(),
    });
  }

  const bySession = new Map<string, { id: string; embedding: number[] }[]>();
  for (const t of thoughts) {
    if (!t.sessionId || !t.embeddingJson) continue;
    let embedding: number[];
    try {
      embedding = JSON.parse(t.embeddingJson);
    } catch {
      continue;
    }
    if (!Array.isArray(embedding) || embedding.length === 0) continue;
    const list = bySession.get(t.sessionId) ?? [];
    list.push({ id: t.id, embedding });
    bySession.set(t.sessionId, list);
  }

  const resonances = computeCrossSessionResonances(bySession).map((r) => ({
    ...r,
    sourceSessionId:
      r.sourceSessionId === currentSessionId ? "__current__" : r.sourceSessionId,
    targetSessionId:
      r.targetSessionId === currentSessionId ? "__current__" : r.targetSessionId,
  }));

  return NextResponse.json({ sessions: cosmosSessions, resonances });
}
