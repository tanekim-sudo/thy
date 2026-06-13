import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Update a node's persisted position, or record a return (engagement). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (Array.isArray(body.position)) {
    data.posX = body.position[0];
    data.posY = body.position[1];
    data.posZ = body.position[2];
  }

  if (body.incrementReturn) {
    const t = await prisma.thought.findUnique({ where: { id: params.id } });
    if (t) {
      data.returnCount = t.returnCount + 1;
      // Mass grows with returns; surfacing toward the fruiting state.
      data.mass = t.mass + 0.5;
      if (t.returnCount + 1 >= 3) data.state = "fruiting";
    }
  }

  const updated = await prisma.thought.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json({ id: updated.id, returnCount: updated.returnCount });
}
