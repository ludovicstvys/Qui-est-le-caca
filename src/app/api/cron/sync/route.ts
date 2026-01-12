import { NextResponse } from "next/server";
import { withGlobalSyncLock } from "@/lib/syncLock";
import { runSync } from "@/lib/syncPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Same as POST /api/sync but triggered by Vercel Cron
  return withGlobalSyncLock(async () => {
    const url = new URL(req.url);
    const count = url.searchParams.get("count") ?? undefined; // friends per run
    const out = await runSync({ count: count != null ? Number(count) : undefined, mode: "latest" });
    return NextResponse.json(out);
  });
}
