import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { syncFriendMatches, syncFriendRank } from "@/lib/sync";
import { withGlobalSyncLock } from "@/lib/syncLock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleSync(req: Request) {
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
      fetchedDetails?: number;
      timelineFetched?: number;
      stoppedEarly?: boolean;
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
          fetchedDetails: (r as any).fetchedDetails,
          timelineFetched: (r as any).timelineFetched,
          stoppedEarly: (r as any).stoppedEarly,
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

export async function POST(req: Request) {
  return handleSync(req);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const run = url.searchParams.get("run");

  // Avoid accidental syncs by crawlers / link prefetchers.
  // If you want to trigger sync from a browser address bar, add ?run=1.
  if (run !== "1") {
    const count = url.searchParams.get("count") ?? "10";
    const from = url.searchParams.get("from");
    const max = url.searchParams.get("max");

    return NextResponse.json(
      {
        ok: false,
        error: "GET /api/sync does not run sync by default.",
        howToRun: {
          recommended: {
            method: "POST",
            example: { url: `/api/sync?count=${count}` },
          },
          browser: {
            method: "GET",
            note: "Add run=1 to execute sync via GET (useful from the address bar).",
            example: {
              url: `/api/sync?run=1&count=${count}${from ? `&from=${encodeURIComponent(from)}` : ""}${
                max ? `&max=${max}` : ""
              }`,
            },
          },
          cron: {
            method: "GET",
            example: { url: `/api/cron/sync?count=${Math.min(Number(count) || 10, 25)}` },
          },
        },
      },
      { status: 200 },
    );
  }

  return handleSync(req);
}
