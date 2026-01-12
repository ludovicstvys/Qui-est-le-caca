import { NextResponse } from "next/server";
import { withGlobalSyncLock } from "@/lib/syncLock";
import { runSync } from "@/lib/syncPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withGlobalSyncLock(async () => {
    const url = new URL(req.url);

    const count = Number(url.searchParams.get("count") || 10);
    const from = url.searchParams.get("from") || undefined;
    const max = url.searchParams.get("max") ? Number(url.searchParams.get("max")) : undefined;

    const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(count, 50)) : 10; // friends per run (forced single)

    const out = await runSync({
      friendId: params.id,
      // For a single friend, we keep `count` as a UX-friendly knob: it becomes a soft cap for match IDs per run.
      max: from ? max : safeCount,
      from,
      mode: from ? "backfill" : "latest",
      count: 1,
    });

    const r0 = out.results?.[0];
    const ok = (r0?.ok ?? true) === true;

    return NextResponse.json({
      ok,
      mode: out.mode,
      from: out.from,
      max: from ? max ?? null : safeCount,
      matchCount: r0?.matchesLinked ?? 0,
      detailsFetched: out.progress?.detailsFetched ?? 0,
      stoppedEarly: out.progress?.stoppedEarly ?? false,
      error: ok ? null : (r0?.error ?? "Sync failed"),
    }, { status: ok ? 200 : 500 });
  });
}
