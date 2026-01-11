import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const friend = await prisma.friend.findUnique({ where: { id: params.id } });
  if (!friend) return NextResponse.json({ error: "Friend not found" }, { status: 404 });
  return NextResponse.json(friend);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  const body = await req.json().catch(() => ({}));
  const avatarUrl = body.avatarUrl === undefined ? undefined : (body.avatarUrl ? String(body.avatarUrl) : null);

  const friend = await prisma.friend.update({
    where: { id: params.id },
    data: { avatarUrl },
  });

  return NextResponse.json(friend);
}
