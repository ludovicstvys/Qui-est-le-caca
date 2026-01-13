import { NextResponse } from "next/server";
import { withGlobalSyncLock } from "@/lib/syncLock";
import { runSync } from "@/lib/syncPipeline";

function clampInt(v: any, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Triggered by Vercel Cron.
  // We run multiple short "ticks" in a single invocation (within a hard time budget)
  // to mimic the front-loop behavior, without exceeding serverless limits.
  return withGlobalSyncLock(async () => {
    const url = new URL(req.url);

    // Optional overrides via querystring
    const countParam = url.searchParams.get("count");
    const modeParam = url.searchParams.get("mode") as any;
    const fromParam = url.searchParams.get("from");

    // Defaults via env (safe: if no from date, we stick to latest)
    const envFrom = process.env.CRON_BACKFILL_FROM;
    const envMode = process.env.CRON_MODE as any;

    const from = fromParam ?? envFrom ?? undefined;
    const mode = (modeParam ?? envMode ?? (from ? "backfill" : "latest")) as "latest" | "backfill";
    const count = countParam != null ? Number(countParam) : undefined;

    const startedAt = Date.now();
    const loopBudgetMs = clampInt(process.env.CRON_LOOP_BUDGET_MS, 255_000, 20_000, 290_000);
    const tickBudgetMs = clampInt(process.env.CRON_TICK_BUDGET_MS, 45_000, 10_000, 120_000);
    const maxLoops = clampInt(process.env.CRON_MAX_LOOPS, 20, 1, 200);

    let runs = 0;
    let last: any = null;

    while (runs < maxLoops) {
      const elapsed = Date.now() - startedAt;
      const remaining = loopBudgetMs - elapsed;
      if (remaining <= 1800) break; // keep buffer

      const thisTickBudget = Math.max(10_000, Math.min(tickBudgetMs, remaining));

      last = await runSync({
        mode,
        from,
        count,
        timeBudgetMs: thisTickBudget,
      });

      runs += 1;

      if (last?.done === true) break;

      // Gentle pacing to smooth quota / avoid tight loop on 429.
      const delay = clampInt(last?.nextDelayMs, 700, 0, 5000);
      if (delay > 0) await sleep(delay);
    }

    return NextResponse.json({
      ok: true,
      cron: true,
      mode,
      from: from ?? null,
      runs,
      elapsedMs: Date.now() - startedAt,
      last,
    });
  });
}
