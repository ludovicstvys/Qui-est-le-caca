import { getPrisma } from "@/lib/prisma";
import {getAccountByRiotId, getLeagueEntriesBySummonerId, getMatchById, getMatchIdsByPuuid, getMatchTimelineById, getSummonerByPuuid} from "@/lib/riot";

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

export async function ensureFriendSummonerId(friendId: string) {
  const prisma = getPrisma();
  const friend = await prisma.friend.findUnique({ where: { id: friendId } });
  if (!friend) throw new Error("Friend not found");

  if (!friend.puuid) await ensureFriendPuuid(friendId);

  const refreshed = await prisma.friend.findUnique({ where: { id: friendId } });
  if (!refreshed?.puuid) throw new Error("Missing puuid");

  if (refreshed.summonerId) return refreshed.summonerId;

  const summ = await getSummonerByPuuid(refreshed.puuid);
  const summonerId = summ?.id;
  if (!summonerId) throw new Error("Unable to resolve summonerId");

  await prisma.friend.update({
    where: { id: friendId },
    data: { summonerId },
  });

  return summonerId as string;
}

export async function syncFriendRank(friendId: string) {
  const prisma = getPrisma();

  const friend = await prisma.friend.findUnique({ where: { id: friendId } });
  if (!friend) throw new Error("Friend not found");

  // Refresh every 10 minutes max to avoid quota spikes
  const freshMs = 10 * 60_000;
  if (friend.rankFetchedAt && Date.now() - friend.rankFetchedAt.getTime() < freshMs) {
    return { skipped: true };
  }

  const summonerId = await ensureFriendSummonerId(friendId);
  const entries = await getLeagueEntriesBySummonerId(summonerId);

  const solo = Array.isArray(entries) ? entries.find((e: any) => e?.queueType === "RANKED_SOLO_5x5") : null;
  const flex = Array.isArray(entries) ? entries.find((e: any) => e?.queueType === "RANKED_FLEX_SR") : null;

  await prisma.friend.update({
    where: { id: friendId },
    data: {
      rankedSoloTier: solo?.tier ?? null,
      rankedSoloRank: solo?.rank ?? null,
      rankedSoloLP: typeof solo?.leaguePoints === "number" ? solo.leaguePoints : null,
      rankedSoloWins: typeof solo?.wins === "number" ? solo.wins : null,
      rankedSoloLosses: typeof solo?.losses === "number" ? solo.losses : null,

      rankedFlexTier: flex?.tier ?? null,
      rankedFlexRank: flex?.rank ?? null,
      rankedFlexLP: typeof flex?.leaguePoints === "number" ? flex.leaguePoints : null,
      rankedFlexWins: typeof flex?.wins === "number" ? flex.wins : null,
      rankedFlexLosses: typeof flex?.losses === "number" ? flex.losses : null,

      rankFetchedAt: new Date(),
    },
  });

  return { skipped: false };
}

export async function syncFriendMatches(friendId: string, count = 10) {
  const prisma = getPrisma();

  const puuid = await ensureFriendPuuid(friendId);
  const matchIds = await getMatchIdsByPuuid(puuid, count);

  // Helper: detect placeholder rows (rawJson = {} or missing match payload)
  const hasMatchPayload = (raw: any) =>
    raw && typeof raw === "object" && ("info" in raw) && ("metadata" in raw);

  // 1) FK requires Match rows to exist before FriendMatch rows.
  // IMPORTANT: set fetchedAt to epoch so placeholders are considered stale and will be filled immediately.
  await prisma.match.createMany({
    data: matchIds.map((id) => ({ id, rawJson: {}, fetchedAt: new Date(0) })),
    skipDuplicates: true,
  });

  // 2) Link Friend <-> Match
  await prisma.friendMatch.createMany({
    data: matchIds.map((matchId) => ({ friendId, matchId })),
    skipDuplicates: true,
  });

  // Optional: fetch timeline too (can be heavy). Enable by setting FETCH_TIMELINE="1"
  const fetchTimeline = process.env.FETCH_TIMELINE === "1";

  // 3) Fetch details and update
  for (const matchId of matchIds) {
    const existing = await prisma.match.findUnique({ where: { id: matchId } });

    const shouldFetchMatch =
      !existing || !hasMatchPayload(existing.rawJson) || !isFresh(existing.fetchedAt);

    if (shouldFetchMatch) {
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

    if (fetchTimeline) {
      // Timeline can be large; only refetch if missing or older than freshness window.
      const current = existing ?? (await prisma.match.findUnique({ where: { id: matchId } }));
      const shouldFetchTimeline =
        !current?.timelineJson || !current?.timelineFetchedAt || !isFresh(current.timelineFetchedAt);

      if (shouldFetchTimeline) {
        const timeline = await getMatchTimelineById(matchId);
        await prisma.match.update({
          where: { id: matchId },
          data: { timelineJson: timeline, timelineFetchedAt: new Date() },
        });
      }
    }
  }

  return { puuid, matchIds };
}
