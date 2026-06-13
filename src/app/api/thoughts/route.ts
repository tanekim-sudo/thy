import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Load the signed-in user's entire field: nodes, filaments, ontology signature. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const [thoughts, filaments, field] = await Promise.all([
    prisma.thought.findMany({ where: { userId }, orderBy: { timestamp: "asc" } }),
    prisma.filament.findMany({ where: { userId } }),
    prisma.fieldState.findUnique({ where: { userId } }),
  ]);

  return NextResponse.json({
    nodes: thoughts.map((t) => ({
      id: t.id,
      rawText: t.rawText,
      prosody: t.prosodyJson ? JSON.parse(t.prosodyJson) : undefined,
      timestamp: t.timestamp.getTime(),
      returnCount: t.returnCount,
      position: [t.posX, t.posY, t.posZ],
      velocity: [t.velX, t.velY, t.velZ],
      mass: t.mass,
      luminosity: t.luminosity,
      texture: t.texture,
      state: t.state,
      charge: t.charge,
      embedding: t.embeddingJson ? JSON.parse(t.embeddingJson) : undefined,
      isSynthesis: t.isSynthesis,
      sourceThoughtIds: t.sourceThoughtIds ? JSON.parse(t.sourceThoughtIds) : undefined,
    })),
    filaments: filaments.map((f) => ({
      id: f.id,
      sourceId: f.sourceId,
      targetId: f.targetId,
      strength: f.strength,
      type: f.type,
      ageSessions: f.ageSessions,
      isActive: f.isActive,
      traffic: f.traffic,
      growth: 1,
    })),
    ontologySignature: field ? JSON.parse(field.ontologySignature) : {},
  });
}

/** Persist a newly crystallized thought. The raw text is never cleaned. */
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json();
  const {
    id,
    rawText,
    prosody,
    position,
    texture,
    isSynthesis,
    sourceThoughtIds,
    sessionId,
  } = body;

  if (typeof rawText !== "string" || rawText.trim().length === 0) {
    return NextResponse.json({ error: "empty thought" }, { status: 400 });
  }

  if (sessionId) {
    await prisma.session.upsert({
      where: { id: sessionId },
      create: { id: sessionId, userId },
      update: {},
    });
  }

  const thought = await prisma.thought.create({
    data: {
      ...(id ? { id } : {}),
      userId,
      rawText,
      prosodyJson: prosody ? JSON.stringify(prosody) : null,
      posX: position?.[0] ?? 0,
      posY: position?.[1] ?? 0,
      posZ: position?.[2] ?? 0,
      texture: texture || "smooth",
      isSynthesis: Boolean(isSynthesis),
      sourceThoughtIds: sourceThoughtIds ? JSON.stringify(sourceThoughtIds) : null,
      sessionId: sessionId || null,
      mass: isSynthesis ? 2 : 1,
      state: "spore",
    },
  });

  // Synthesis fuses two existing thoughts — wire structural filaments immediately.
  if (isSynthesis && Array.isArray(sourceThoughtIds)) {
    // Only link to source thoughts the user actually owns.
    const owned = await prisma.thought.findMany({
      where: { id: { in: sourceThoughtIds }, userId },
      select: { id: true },
    });
    for (const src of owned) {
      await prisma.filament.create({
        data: {
          userId,
          sourceId: src.id,
          targetId: thought.id,
          strength: 0.6,
          type: "resonance",
          traffic: 1,
        },
      });
    }
  }

  return NextResponse.json({ id: thought.id });
}
