import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { champ: string; games: number; wins: number; winrate: number };

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const friend = await prisma.friend.findUnique({ where: { id: params.id } });
  if (!friend) return NextResponse.json({ error: "Friend not found" }, { status: 404 });
  if (!friend.puuid) return NextResponse.json({ ok: true, champs: [], lanes: [], roles: [] });

  const take = 200;

  const parts = await prisma.matchParticipant.findMany({
    where: {
      puuid: friend.puuid,
      match: { queueId: 420 }, // Ranked Solo
    },
    include: { match: true },
    orderBy: { match: { gameStartMs: "desc" } },
    take,
  });

  const champs = new Map<string, { games: number; wins: number }>();
  const lanes = new Map<string, number>();
  const roles = new Map<string, number>();

  for (const p of parts) {
    const champ = p.championName ?? "Unknown";
    const lane = p.lane ?? "—";
    const role = p.role ?? "—";

    const c = champs.get(champ) ?? { games: 0, wins: 0 };
    c.games += 1;
    c.wins += p.win ? 1 : 0;
    champs.set(champ, c);

    lanes.set(lane, (lanes.get(lane) ?? 0) + 1);
    roles.set(role, (roles.get(role) ?? 0) + 1);
  }

  const champRows: Row[] = Array.from(champs.entries())
    .map(([champ, v]) => ({
      champ,
      games: v.games,
      wins: v.wins,
      winrate: v.games ? Math.round((v.wins / v.games) * 100) : 0,
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const laneRows = Array.from(lanes.entries()).map(([k, v]) => ({ lane: k, games: v })).sort((a, b) => b.games - a.games);
  const roleRows = Array.from(roles.entries()).map(([k, v]) => ({ role: k, games: v })).sort((a, b) => b.games - a.games);

  return NextResponse.json({ ok: true, champs: champRows, lanes: laneRows, roles: roleRows, sample: parts.length });
}
