import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Update a node's persisted position, or record a return (engagement). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  // Ensure the node belongs to the signed-in user.
  const owned = await prisma.thought.findFirst({
    where: { id: params.id, userId },
  });
  if (!owned) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (Array.isArray(body.position)) {
    data.posX = body.position[0];
    data.posY = body.position[1];
    data.posZ = body.position[2];
  }

  if (body.incrementReturn) {
    data.returnCount = owned.returnCount + 1;
    // Mass grows with returns; surfacing toward the fruiting state.
    data.mass = owned.mass + 0.5;
    data.luminosity = Math.min(1, owned.luminosity + 0.2);
    data.attentionCount = owned.attentionCount + 1;
    data.lastAttendedAt = new Date();
    if (owned.returnCount + 1 >= 3) data.state = "fruiting";
  }

  // Attention without a full "return" — confidence (opacity) and a little mass.
  if (body.attention && typeof body.attention === "object") {
    const { opacity, mass } = body.attention as { opacity?: number; mass?: number };
    if (typeof opacity === "number") data.luminosity = Math.max(0, Math.min(1, opacity));
    if (typeof mass === "number") data.mass = mass;
    data.attentionCount = owned.attentionCount + 1;
    data.lastAttendedAt = new Date();
  }

  const updated = await prisma.thought.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({ id: updated.id, returnCount: updated.returnCount });
}

/** Hard-delete a fragment — used for unattended, ephemeral AI-origin fragments. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const owned = await prisma.thought.findFirst({ where: { id: params.id, userId } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.thought.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
