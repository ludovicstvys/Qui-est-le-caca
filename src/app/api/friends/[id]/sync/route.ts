import { NextResponse } from "next/server";
import { syncFriendMatches, syncFriendRank } from "@/lib/sync";
import { withGlobalSyncLock } from "@/lib/syncLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withGlobalSyncLock(async () => {
    const url = new URL(req.url);

    const count = Number(url.searchParams.get("count") || 10);
    const from = url.searchParams.get("from") || undefined;
    const max = url.searchParams.get("max") ? Number(url.searchParams.get("max")) : undefined;

    const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(count, 50)) : 10;

    await syncFriendRank(params.id);

    const r = await syncFriendMatches(params.id, from ? { from, max } : safeCount);

    return NextResponse.json({
      ok: true,
      matchCount: r.matchIds.length,
      fetchedDetails: (r as any).fetchedDetails,
      timelineFetched: (r as any).timelineFetched,
      stoppedEarly: (r as any).stoppedEarly,
      mode: from ? "backfill" : "latest",
      from: from ?? null,
      max: max ?? null,
    });
  });
}
