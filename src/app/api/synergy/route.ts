import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PairKey = string;

export async function GET(req: Request) {
  const prisma = getPrisma();
  const url = new URL(req.url);
  const takeMatches = Math.max(50, Math.min(Number(url.searchParams.get("take") || 400), 2000));

  const friends = await prisma.friend.findMany({ where: { puuid: { not: null } }, orderBy: { createdAt: "asc" } });
  const mapName = new Map<string, string>();
  const puuids = friends.map((f) => {
    mapName.set(f.puuid!, `${f.riotName}#${f.riotTag}`);
    return f.puuid!;
  });

  if (puuids.length < 2) return NextResponse.json({ ok: true, pairs: [] });

  // Limit work: only consider participants from the newest N matches in DB
  const recentMatches = await prisma.match.findMany({
    select: { id: true },
    orderBy: { gameStartMs: "desc" },
    take: takeMatches,
  });
  const matchIds = recentMatches.map((m) => m.id);
  if (matchIds.length === 0) return NextResponse.json({ ok: true, pairs: [] });

  const ps = await prisma.matchParticipant.findMany({
    where: { matchId: { in: matchIds }, puuid: { in: puuids } },
    select: { matchId: true, puuid: true, teamId: true, win: true },
  });

  const byMatch = new Map<string, Array<{ puuid: string; teamId: number | null; win: boolean | null }>>();
  for (const p of ps) {
    const arr = byMatch.get(p.matchId) ?? [];
    arr.push({ puuid: p.puuid, teamId: (p.teamId as any) ?? null, win: (p.win as any) ?? null });
    byMatch.set(p.matchId, arr);
  }

  const pairs = new Map<PairKey, { a: string; b: string; games: number; wins: number }>();

  const sort2 = (x: string, y: string) => (x < y ? [x, y] : [y, x]);

  for (const [_mid, arr] of byMatch.entries()) {
    // Friends in this match
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const A = arr[i];
        const B = arr[j];
        // Synergy = same team
        if (A.teamId == null || B.teamId == null || A.teamId !== B.teamId) continue;

        const [p1, p2] = sort2(A.puuid, B.puuid);
        const key = `${p1}::${p2}`;
        const row = pairs.get(key) ?? { a: p1, b: p2, games: 0, wins: 0 };
        row.games += 1;

        const win = (A.win === true) || (B.win === true); // same team, should match
        if (win) row.wins += 1;

        pairs.set(key, row);
      }
    }
  }

  const out = Array.from(pairs.values())
    .map((r) => ({
      aPuuid: r.a,
      bPuuid: r.b,
      a: mapName.get(r.a) ?? r.a,
      b: mapName.get(r.b) ?? r.b,
      games: r.games,
      wins: r.wins,
      winrate: r.games ? Math.round((r.wins / r.games) * 100) : 0,
    }))
    .sort((x, y) => y.games - x.games)
    .slice(0, 60);

  return NextResponse.json({ ok: true, pairs: out, sampleMatches: byMatch.size });
}
