import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { syncFriendMatches, syncFriendRank } from "@/lib/sync";
import { withGlobalSyncLock } from "@/lib/syncLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return withGlobalSyncLock(async () => {
    const prisma = getPrisma();
    const url = new URL(req.url);

    const count = Number(url.searchParams.get("count") || 10);
    const from = url.searchParams.get("from") || undefined;
    const max = url.searchParams.get("max") ? Number(url.searchParams.get("max")) : undefined;

    const friends = await prisma.friend.findMany({ orderBy: { createdAt: "asc" } });

    const results: Array<{
      friendId: string;
      riot: string;
      ok: boolean;
      error?: string;
      syncedMatches?: number;
    }> = [];

    const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(count, 50)) : 10;

    // Sequential sync to reduce Riot quota spikes (and to keep within serverless time)
    for (const f of friends) {
      try {
        await syncFriendRank(f.id);
        const r = await syncFriendMatches(f.id, from ? { from, max } : safeCount);
        results.push({
          friendId: f.id,
          riot: `${f.riotName}#${f.riotTag}`,
          ok: true,
          syncedMatches: r.matchIds.length,
        });
      } catch (e: any) {
        results.push({
          friendId: f.id,
          riot: `${f.riotName}#${f.riotTag}`,
          ok: false,
          error: e?.message ?? "Unknown error",
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({
      ok: true,
      total: results.length,
      okCount,
      results,
      mode: from ? "backfill" : "latest",
      from: from ?? null,
      max: max ?? null,
      count: safeCount,
    });
  });
}
