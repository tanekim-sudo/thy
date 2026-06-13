import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Load the entire field: nodes, filaments, ontology signature. */
export async function GET() {
  const [thoughts, filaments, field] = await Promise.all([
    prisma.thought.findMany({ orderBy: { timestamp: "asc" } }),
    prisma.filament.findMany(),
    prisma.fieldState.findUnique({ where: { id: "singleton" } }),
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
      create: { id: sessionId },
      update: {},
    });
  }

  const thought = await prisma.thought.create({
    data: {
      ...(id ? { id } : {}),
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
    for (const srcId of sourceThoughtIds) {
      await prisma.filament.create({
        data: {
          sourceId: srcId,
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
