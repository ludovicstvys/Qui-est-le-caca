import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { syncFriendMatches, syncFriendRank } from "@/lib/sync";
import { withGlobalSyncLock } from "@/lib/syncLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Same as POST /api/sync but triggered by Vercel Cron
  return withGlobalSyncLock(async () => {
    const prisma = getPrisma();
    const url = new URL(req.url);
    const count = Number(url.searchParams.get("count") || 10);
    const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(count, 25)) : 10;

    const friends = await prisma.friend.findMany({ orderBy: { createdAt: "asc" } });

    for (const f of friends) {
      try {
        await syncFriendRank(f.id);
        await syncFriendMatches(f.id, safeCount);
      } catch {
        // swallow errors to allow next friend
      }
    }

    return NextResponse.json({ ok: true, total: friends.length, count: safeCount });
  });
}
