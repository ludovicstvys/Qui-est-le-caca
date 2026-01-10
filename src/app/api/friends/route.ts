import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const prisma = getPrisma();
  const friends = await prisma.friend.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(friends);
}

export async function POST(req: Request) {
  const prisma = getPrisma();

  const body = await req.json().catch(() => ({}));
  const riotName = String(body.riotName || "").trim();
  const riotTag = String(body.riotTag || "").trim();
  const region = String(body.region || "euw1").trim();
  const avatarUrl = body.avatarUrl ? String(body.avatarUrl).trim() : null;

  if (!riotName || !riotTag) {
    return NextResponse.json({ error: "riotName and riotTag required" }, { status: 400 });
  }

  const friend = await prisma.friend.create({
    data: { riotName, riotTag, region, avatarUrl: avatarUrl || null },
  });

  return NextResponse.json(friend, { status: 201 });
}
