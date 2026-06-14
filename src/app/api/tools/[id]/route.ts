import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const owned = await prisma.tool.findFirst({ where: { id: params.id, userId } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.instruction === "string" && body.instruction.trim()) {
    data.instruction = body.instruction.trim();
  }
  if (body.used === true) {
    data.lastUsedAt = new Date();
    data.attentionCount = owned.attentionCount + 1;
    data.mass = Math.min(2.5, owned.mass + 0.05);
    data.opacity = Math.min(1, owned.opacity + 0.04);
  }

  const tool = await prisma.tool.update({ where: { id: params.id }, data });
  return NextResponse.json({ id: tool.id, instruction: tool.instruction });
}
