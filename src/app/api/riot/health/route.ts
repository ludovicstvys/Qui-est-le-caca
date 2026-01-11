import { NextResponse } from "next/server";
import { getPlatformStatus } from "@/lib/riot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simple health-check endpoint to quickly validate that RIOT_API_KEY + RIOT_REGION work.
// Does NOT expose the API key.
export async function GET() {
  try {
    const data = await getPlatformStatus({ label: "status/platform-data" });
    return NextResponse.json({ ok: true, status: data?.status ?? "ok" });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
        hint:
          "If this is 403 Forbidden, your Riot API key is invalid/expired or not set on this Vercel environment. Update RIOT_API_KEY and redeploy.",
      },
      { status: 200 }
    );
  }
}
