import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { matchId: string } }) {
  const prisma = getPrisma();
  const match = await prisma.match.findUnique({ where: { id: params.matchId } });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  return NextResponse.json({
    matchId: match.id,
    raw: match.rawJson,
    timeline: match.timelineJson,
    gameStartMs: match.gameStartMs?.toString() ?? null,
    gameDurationS: match.gameDurationS,
    queueId: match.queueId,
    fetchedAt: match.fetchedAt,
    timelineFetchedAt: match.timelineFetchedAt,
  });
}
