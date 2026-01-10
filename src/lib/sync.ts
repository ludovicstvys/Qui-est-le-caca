import { getPrisma } from "@/lib/prisma";
import { getAccountByRiotId, getMatchById, getMatchIdsByPuuid } from "@/lib/riot";

const DEFAULT_FRESHNESS_MINUTES = 30;

function freshnessMinutes() {
  const val = process.env.MATCH_FRESHNESS_MINUTES;
  const n = val ? Number(val) : DEFAULT_FRESHNESS_MINUTES;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FRESHNESS_MINUTES;
}

function isFresh(date: Date) {
  return Date.now() - date.getTime() < freshnessMinutes() * 60_000;
}

export async function ensureFriendPuuid(friendId: string) {
  const prisma = getPrisma();

  const friend = await prisma.friend.findUnique({ where: { id: friendId } });
  if (!friend) throw new Error("Friend not found");

  if (friend.puuid) return friend.puuid;

  const acc = await getAccountByRiotId(friend.riotName, friend.riotTag);
  await prisma.friend.update({
    where: { id: friendId },
    data: { puuid: acc.puuid },
  });

  return acc.puuid;
}

export async function syncFriendMatches(friendId: string, count = 10) {
  const prisma = getPrisma();

  const puuid = await ensureFriendPuuid(friendId);

  const matchIds = await getMatchIdsByPuuid(puuid, count);

  // 1) IMPORTANT : créer des lignes Match "placeholder" pour satisfaire la FK
  // rawJson est required => on met {} au début (sera remplacé ensuite)
  await prisma.match.createMany({
    data: matchIds.map((id) => ({
      id,
      rawJson: {}, // placeholder JSON
      // le reste peut être null (platform/gameStartMs/etc)
    })),
    skipDuplicates: true,
  });

  // 2) Ensuite seulement, créer les liens Friend <-> Match
  await prisma.friendMatch.createMany({
    data: matchIds.map((matchId) => ({ friendId, matchId })),
    skipDuplicates: true,
  });

  // 3) Puis fetch les détails et update/upsert
  for (const matchId of matchIds) {
    const existing = await prisma.match.findUnique({ where: { id: matchId } });
    if (existing && isFresh(existing.fetchedAt)) continue;

    const raw = await getMatchById(matchId);
    const info = raw?.info;

    const gameStartMs =
      typeof info?.gameStartTimestamp === "number" ? BigInt(info.gameStartTimestamp) : null;
    const gameDurationS =
      typeof info?.gameDuration === "number" ? info.gameDuration : null;
    const queueId = typeof info?.queueId === "number" ? info.queueId : null;
    const platform = typeof info?.platformId === "string" ? info.platformId : null;

    await prisma.match.update({
      where: { id: matchId },
      data: {
        rawJson: raw,
        platform,
        gameStartMs,
        gameDurationS,
        queueId,
        fetchedAt: new Date(),
      },
    });
  }

  return { puuid, matchIds };
}

