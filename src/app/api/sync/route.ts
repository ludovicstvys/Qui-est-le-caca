import { NextResponse } from "next/server";
import { withGlobalSyncLock } from "@/lib/syncLock";
import { runSync } from "@/lib/syncPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleSync(req: Request) {
  return withGlobalSyncLock(async () => {
    const url = new URL(req.url);

    const count = url.searchParams.get("count") ?? undefined; // friends per run
    const from = url.searchParams.get("from") ?? undefined;
    const max = url.searchParams.get("max") ?? undefined; // matchIds per friend per run
    const mode = (url.searchParams.get("mode") ?? undefined) as any;

    const out = await runSync({
      mode,
      from,
      count: count != null ? Number(count) : undefined,
      max: max != null ? Number(max) : undefined,
    });

    return NextResponse.json(out);
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
