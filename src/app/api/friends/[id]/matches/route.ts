import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  const rows = await prisma.friendMatch.findMany({
    where: { friendId: params.id },
    include: { match: true },
    orderBy: { addedAt: "desc" },
    take: 10,
  });

  const payload = rows
    .filter((r) => r.match)
    .map((r) => ({
      matchId: r.matchId,
      gameStartMs: r.match.gameStartMs?.toString() ?? null,
      gameDurationS: r.match.gameDurationS,
      queueId: r.match.queueId,
      raw: r.match.rawJson,
    }));

  return NextResponse.json(payload);
}
