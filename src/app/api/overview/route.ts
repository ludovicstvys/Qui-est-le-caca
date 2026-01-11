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

export async function GET() {
  const prisma = getPrisma();

  const friends = await prisma.friend.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      matches: {
        take: 1,
        orderBy: { addedAt: "desc" },
        include: { match: { include: { participants: true } } },
      },
    },
  });

  const payload = friends.map((f) => {
    const last = f.matches[0]?.match ?? null;
    let lastGame: any = null;

    if (last && f.puuid) {
      const me = last.participants.find((p) => p.puuid === f.puuid);
      const k = me?.kills ?? null;
      const d = me?.deaths ?? null;
      const a = me?.assists ?? null;
      lastGame = {
        matchId: last.id,
        queueId: last.queueId,
        gameStartMs: last.gameStartMs?.toString() ?? null,
        gameDurationS: last.gameDurationS,
        champ: me?.championName ?? null,
        win: me?.win ?? null,
        kda: k != null && d != null && a != null ? `${k}/${d}/${a}` : null,
      };
    }

    return {
      id: f.id,
      riotName: f.riotName,
      riotTag: f.riotTag,
      puuid: f.puuid,
      avatarUrl: f.avatarUrl,
      lastMatchId: f.lastMatchId,
      lastSyncAt: f.lastSyncAt,
      rankedSoloTier: f.rankedSoloTier,
      rankedSoloRank: f.rankedSoloRank,
      rankedSoloLP: f.rankedSoloLP,
      rankedSoloWins: f.rankedSoloWins,
      rankedSoloLosses: f.rankedSoloLosses,
      rankedFlexTier: f.rankedFlexTier,
      rankedFlexRank: f.rankedFlexRank,
      rankedFlexLP: f.rankedFlexLP,
      rankedFlexWins: f.rankedFlexWins,
      rankedFlexLosses: f.rankedFlexLosses,
      lastGame,
    };
  });

  return NextResponse.json(payload);
}
