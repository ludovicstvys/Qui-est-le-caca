import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const prisma = getPrisma();

  const [friendCount, matchCount, pendingMatchCount, pendingBackfillCount] = await Promise.all([
    prisma.friend.count(),
    prisma.match.count(),
    prisma.match.count({ where: { gameStartMs: null } }),
    prisma.friendSyncState.count({ where: { matchlistDone: false } }),
  ]);

  const recentlyTouched = await prisma.friendSyncState.findMany({
    take: 15,
    orderBy: { updatedAt: "desc" },
    include: { friend: true },
  });

  return NextResponse.json({
    ok: true,
    counts: {
      friends: friendCount,
      matches: matchCount,
      pendingMatchDetails: pendingMatchCount,
      pendingBackfillFriends: pendingBackfillCount,
    },
    recent: recentlyTouched.map((s) => ({
      friendId: s.friendId,
      riot: `${s.friend.riotName}#${s.friend.riotTag}`,
      matchlistCursorStart: s.matchlistCursorStart,
      matchlistDone: s.matchlistDone,
      backfillFromTs: s.backfillFromTs?.toString() ?? null,
      backfillEndTs: s.backfillEndTs?.toString() ?? null,
      lastRunAt: s.lastRunAt,
      updatedAt: s.updatedAt,
    })),
  });
}
