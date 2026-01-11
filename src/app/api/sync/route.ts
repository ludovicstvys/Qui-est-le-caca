import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { syncFriendMatches, syncFriendRank } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const prisma = getPrisma();
  const url = new URL(req.url);
  const count = Number(url.searchParams.get("count") || 10);

  const friends = await prisma.friend.findMany({ orderBy: { createdAt: "asc" } });

  const results: Array<{ friendId: string; riot: string; ok: boolean; error?: string }> = [];

  // Sequential sync to reduce Riot quota spikes
  for (const f of friends) {
    try {
      await syncFriendRank(f.id);
      await syncFriendMatches(f.id, Number.isFinite(count) ? Math.max(1, Math.min(count, 50)) : 10);
      results.push({ friendId: f.id, riot: `${f.riotName}#${f.riotTag}`, ok: true });
    } catch (e: any) {
      results.push({ friendId: f.id, riot: `${f.riotName}#${f.riotTag}`, ok: false, error: e?.message ?? "Unknown error" });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, total: results.length, okCount, results });
}
