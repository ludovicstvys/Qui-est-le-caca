import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function displayName(p: any) {
  const gn = p?.riotIdGameName;
  const tl = p?.riotIdTagline;
  if (gn && tl) return `${gn}#${tl}`;
  return p?.summonerName ?? "Unknown";
}

function cs(p: any) {
  const a = typeof p?.totalMinionsKilled === "number" ? p.totalMinionsKilled : 0;
  const b = typeof p?.neutralMinionsKilled === "number" ? p.neutralMinionsKilled : 0;
  return a + b;
}

function normalizeParticipantsFromRaw(raw: any) {
  const arr = raw?.info?.participants;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((p: any) => ({
      puuid: typeof p?.puuid === "string" ? p.puuid : null,
      teamId: typeof p?.teamId === "number" ? p.teamId : null,
      win: typeof p?.win === "boolean" ? p.win : null,
      summonerName: typeof p?.summonerName === "string" ? p.summonerName : null,
      riotIdGameName: typeof p?.riotIdGameName === "string" ? p.riotIdGameName : null,
      riotIdTagline: typeof p?.riotIdTagline === "string" ? p.riotIdTagline : null,
      championName: typeof p?.championName === "string" ? p.championName : null,
      lane: typeof p?.lane === "string" ? p.lane : null,
      role: typeof p?.role === "string" ? p.role : null,
      kills: typeof p?.kills === "number" ? p.kills : null,
      deaths: typeof p?.deaths === "number" ? p.deaths : null,
      assists: typeof p?.assists === "number" ? p.assists : null,
      goldEarned: typeof p?.goldEarned === "number" ? p.goldEarned : null,
      totalDamageDealtToChampions:
        typeof p?.totalDamageDealtToChampions === "number" ? p.totalDamageDealtToChampions : null,
      visionScore: typeof p?.visionScore === "number" ? p.visionScore : null,
      totalMinionsKilled: typeof p?.totalMinionsKilled === "number" ? p.totalMinionsKilled : 0,
      neutralMinionsKilled: typeof p?.neutralMinionsKilled === "number" ? p.neutralMinionsKilled : 0,
    }))
    .filter((p: any) => p.puuid);
}

export async function GET(_req: Request, { params }: { params: { matchId: string } }) {
  const prisma = getPrisma();

  const match = await prisma.match.findUnique({
    where: { id: params.matchId },
    include: { participants: true, friends: { include: { friend: true } } },
  });
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });

  let parts: any[] = Array.isArray(match.participants) ? match.participants : [];
  if (parts.length < 10) {
    const fromRaw = normalizeParticipantsFromRaw(match.rawJson);
    if (fromRaw.length >= parts.length) parts = fromRaw;
  }

  const sum = (arr: any[], key: string) =>
    arr.reduce((s, p) => s + (typeof (p as any)[key] === "number" ? (p as any)[key] : 0), 0);

  const teams = Array.from(
    new Set(parts.map((p) => p.teamId).filter((x) => typeof x === "number"))
  ) as number[];

  const teamPayload = teams.map((tid) => {
    const ps = parts.filter((p) => p.teamId === tid);
    return {
      teamId: tid,
      kills: sum(ps, "kills"),
      deaths: sum(ps, "deaths"),
      assists: sum(ps, "assists"),
      gold: sum(ps, "goldEarned"),
      dmg: sum(ps, "totalDamageDealtToChampions"),
    };
  });

  const friendTags = match.friends.map((fm) => ({
    id: fm.friendId,
    riot: `${fm.friend.riotName}#${fm.friend.riotTag}`,
    puuid: fm.friend.puuid,
  }));

  const payload = {
    matchId: match.id,
    platform: match.platform,
    queueId: match.queueId,
    gameStartMs: match.gameStartMs?.toString() ?? null,
    gameDurationS: match.gameDurationS,
    fetchedAt: match.fetchedAt,
    timelineFetchedAt: match.timelineFetchedAt,
    teams: teamPayload,
    friends: friendTags,
    participants: parts.map((p) => ({
      puuid: p.puuid,
      teamId: p.teamId,
      win: p.win,
      name: displayName(p),
      champ: p.championName,
      lane: p.lane,
      role: p.role,
      k: p.kills,
      d: p.deaths,
      a: p.assists,
      cs: cs(p),
      vision: p.visionScore,
      dmg: p.totalDamageDealtToChampions,
      gold: p.goldEarned,
    })),
    raw: match.rawJson,
    timeline: match.timelineJson,
    participantCount: parts.length,
  };

  return NextResponse.json(payload);
}
