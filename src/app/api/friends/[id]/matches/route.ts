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
      matchId: raw?.metadata?.matchId ?? null,
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

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const url = new URL(req.url);

  const includeTimeline = url.searchParams.get("includeTimeline") === "1";
  const take = Math.max(1, Math.min(Number(url.searchParams.get("take") || 30), 200));
  const from = url.searchParams.get("from") || null;

  const friend = await prisma.friend.findUnique({ where: { id: params.id } });
  if (!friend) return NextResponse.json({ error: "Friend not found" }, { status: 404 });

  const rows = await prisma.friendMatch.findMany({
    where: { friendId: params.id },
    include: { match: { include: { participants: true } } },
    // Display games by real in-game date (not insertion date).
    orderBy: [{ match: { gameStartMs: "desc" } }, { addedAt: "desc" }],
    take,
  });

  
  const fromMs = from ? new Date(`${from}T00:00:00Z`).getTime() : null;
const payload = rows
    .filter((r) => r.match)
    .map((r) => {
      const m = r.match!;

      // Prefer denormalized table; fallback to rawJson if old DB or missing participants
      let parts: any[] = Array.isArray(m.participants) ? m.participants : [];
      if (parts.length < 10) {
        const fromRaw = normalizeParticipantsFromRaw(m.rawJson);
        if (fromRaw.length >= parts.length) parts = fromRaw;
      }

      const me = friend.puuid ? parts.find((p) => p.puuid === friend.puuid) : null;

      const teamId = me?.teamId ?? null;
      const allies = teamId != null ? parts.filter((p) => p.teamId === teamId) : [];
      const enemies = teamId != null ? parts.filter((p) => p.teamId != null && p.teamId !== teamId) : [];

      const sum = (arr: any[], key: string) =>
        arr.reduce((s, p) => s + (typeof (p as any)[key] === "number" ? (p as any)[key] : 0), 0);

      const allyKills = sum(allies, "kills");
      const enemyKills = sum(enemies, "kills");
      const allyGold = sum(allies, "goldEarned");
      const enemyGold = sum(enemies, "goldEarned");
      const allyDmg = sum(allies, "totalDamageDealtToChampions");
      const enemyDmg = sum(enemies, "totalDamageDealtToChampions");

      return {
        matchId: r.matchId,
        gameStartMs: m.gameStartMs?.toString() ?? null,
        gameDurationS: m.gameDurationS,
        queueId: m.queueId,
        win: me?.win ?? null,
        champ: me?.championName ?? null,
        lane: me?.lane ?? null,
        role: me?.role ?? null,
        k: me?.kills ?? null,
        d: me?.deaths ?? null,
        a: me?.assists ?? null,
        cs: me ? cs(me) : null,
        vision: me?.visionScore ?? null,
        dmg: me?.totalDamageDealtToChampions ?? null,
        gold: me?.goldEarned ?? null,
        team: {
          allyKills,
          enemyKills,
          allyGold,
          enemyGold,
          allyDmg,
          enemyDmg,
        },
        allies: allies.map((p) => ({
          name: displayName(p),
          champ: p.championName ?? null,
          lane: p.lane ?? null,
          role: p.role ?? null,
          k: p.kills ?? null,
          d: p.deaths ?? null,
          a: p.assists ?? null,
          cs: cs(p),
          vision: p.visionScore ?? null,
          dmg: p.totalDamageDealtToChampions ?? null,
          gold: p.goldEarned ?? null,
          puuid: p.puuid,
        })),
        enemies: enemies.map((p) => ({
          name: displayName(p),
          champ: p.championName ?? null,
          lane: p.lane ?? null,
          role: p.role ?? null,
          k: p.kills ?? null,
          d: p.deaths ?? null,
          a: p.assists ?? null,
          cs: cs(p),
          vision: p.visionScore ?? null,
          dmg: p.totalDamageDealtToChampions ?? null,
          gold: p.goldEarned ?? null,
          puuid: p.puuid,
        })),
        // Keep raw for debugging / future enrich (but don't rely on it for UI)
        raw: m.rawJson,
        timeline: includeTimeline ? m.timelineJson : undefined,
        // for UI collapse
        participantCount: parts.length,
      };
    });

  return NextResponse.json(payload);
}
