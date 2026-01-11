import { getPrisma } from "@/lib/prisma";
import {
  getAccountByRiotId,
  getLeagueEntriesBySummonerId,
  getMatchById,
  getMatchIdsByPuuid,
  getMatchTimelineById,
  getSummonerByPuuid,
} from "@/lib/riot";

const DEFAULT_FRESHNESS_MINUTES = 30;

function freshnessMinutes() {
  const val = process.env.MATCH_FRESHNESS_MINUTES;
  const n = val ? Number(val) : DEFAULT_FRESHNESS_MINUTES;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FRESHNESS_MINUTES;
}

function isFresh(date: Date) {
  return Date.now() - date.getTime() < freshnessMinutes() * 60_000;
}

function hasMatchPayload(raw: any) {
  return raw && typeof raw === "object" && ("info" in raw) && ("metadata" in raw);
}

function safeInt(v: any) {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

export async function ensureFriendPuuid(friendId: string) {
  const prisma = getPrisma();

  const friend = await prisma.friend.findUnique({ where: { id: friendId } });
  if (!friend) throw new Error("Friend not found");

  if (friend.puuid) return friend.puuid;

  const acc = await getAccountByRiotId(friend.riotName, friend.riotTag, { friendId, label: "account/by-riot-id" });
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

  const puuid = friend.puuid ?? (await ensureFriendPuuid(friendId));
  if (friend.summonerId) return friend.summonerId;

  const summ = await getSummonerByPuuid(puuid, { friendId, label: "summoner/by-puuid" });
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
  const entries = await getLeagueEntriesBySummonerId(summonerId, { friendId, label: "league/entries/by-summoner" });

  if (
    (() => {
      const v = String(process.env.DEBUG_RIOT || "").trim().toLowerCase();
      return v === "1" || v === "true" || v === "yes" || v === "on";
    })() &&
    Array.isArray(entries) &&
    entries.length === 0
  ) {
    // eslint-disable-next-line no-console
    console.log(`[DEBUG_RIOT] friendId=${friendId} label=league/entries/by-summoner empty []`, { summonerId });
  }

  const solo = Array.isArray(entries) ? entries.find((e: any) => e?.queueType === "RANKED_SOLO_5x5") : null;
  const flex = Array.isArray(entries) ? entries.find((e: any) => e?.queueType === "RANKED_FLEX_SR") : null;

  const next = {
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
  };

  await prisma.friend.update({
    where: { id: friendId },
    data: { ...next, rankFetchedAt: new Date() },
  });

  // Snapshot if changed (or no snapshot)
  const snapshotPairs: Array<{
    queueType: string;
    tier: string | null;
    rank: string | null;
    lp: number | null;
    wins: number | null;
    losses: number | null;
  }> = [
    {
      queueType: "RANKED_SOLO_5x5",
      tier: next.rankedSoloTier,
      rank: next.rankedSoloRank,
      lp: next.rankedSoloLP,
      wins: next.rankedSoloWins,
      losses: next.rankedSoloLosses,
    },
    {
      queueType: "RANKED_FLEX_SR",
      tier: next.rankedFlexTier,
      rank: next.rankedFlexRank,
      lp: next.rankedFlexLP,
      wins: next.rankedFlexWins,
      losses: next.rankedFlexLosses,
    },
  ];

  for (const s of snapshotPairs) {
    const last = await prisma.rankSnapshot.findFirst({
      where: { friendId, queueType: s.queueType },
      orderBy: { createdAt: "desc" },
    });

    const changed =
      !last ||
      last.tier !== s.tier ||
      last.rank !== s.rank ||
      last.lp !== s.lp ||
      last.wins !== s.wins ||
      last.losses !== s.losses;

    // Avoid too many rows: max 1 snapshot/hour if unchanged
    const tooSoon = last && Date.now() - last.createdAt.getTime() < 60 * 60_000;

    if (changed || !tooSoon) {
      await prisma.rankSnapshot.create({
        data: {
          friendId,
          queueType: s.queueType,
          tier: s.tier,
          rank: s.rank,
          lp: s.lp,
          wins: s.wins,
          losses: s.losses,
        },
      });
    }
  }

  return { skipped: false };
}

async function upsertParticipants(matchId: string, raw: any) {
  const prisma = getPrisma();
  const parts = raw?.info?.participants;
  if (!Array.isArray(parts)) return;

  for (const p of parts) {
    const puuid = typeof p?.puuid === "string" ? p.puuid : null;
    if (!puuid) continue;

    const where = { matchId_puuid: { matchId, puuid } } as any;

    await prisma.matchParticipant.upsert({
      where,
      update: {
        teamId: safeInt(p.teamId),
        win: typeof p.win === "boolean" ? p.win : null,
        summonerName: typeof p.summonerName === "string" ? p.summonerName : null,
        riotIdGameName: typeof p.riotIdGameName === "string" ? p.riotIdGameName : null,
        riotIdTagline: typeof p.riotIdTagline === "string" ? p.riotIdTagline : null,
        championName: typeof p.championName === "string" ? p.championName : null,
        lane: typeof p.lane === "string" ? p.lane : null,
        role: typeof p.role === "string" ? p.role : null,
        kills: safeInt(p.kills),
        deaths: safeInt(p.deaths),
        assists: safeInt(p.assists),
        goldEarned: safeInt(p.goldEarned),
        totalDamageDealtToChampions: safeInt(p.totalDamageDealtToChampions),
        visionScore: safeInt(p.visionScore),
        totalMinionsKilled: safeInt(p.totalMinionsKilled),
        neutralMinionsKilled: safeInt(p.neutralMinionsKilled),
      },
      create: {
        matchId,
        puuid,
        teamId: safeInt(p.teamId),
        win: typeof p.win === "boolean" ? p.win : null,
        summonerName: typeof p.summonerName === "string" ? p.summonerName : null,
        riotIdGameName: typeof p.riotIdGameName === "string" ? p.riotIdGameName : null,
        riotIdTagline: typeof p.riotIdTagline === "string" ? p.riotIdTagline : null,
        championName: typeof p.championName === "string" ? p.championName : null,
        lane: typeof p.lane === "string" ? p.lane : null,
        role: typeof p.role === "string" ? p.role : null,
        kills: safeInt(p.kills),
        deaths: safeInt(p.deaths),
        assists: safeInt(p.assists),
        goldEarned: safeInt(p.goldEarned),
        totalDamageDealtToChampions: safeInt(p.totalDamageDealtToChampions),
        visionScore: safeInt(p.visionScore),
        totalMinionsKilled: safeInt(p.totalMinionsKilled),
        neutralMinionsKilled: safeInt(p.neutralMinionsKilled),
      },
    });
  }
}

export async function syncFriendMatches(
  friendId: string,
  countOrOpts: number | { count?: number; from?: string; max?: number } = 10
) {
  const prisma = getPrisma();

  const opts =
    typeof countOrOpts === "number"
      ? { count: countOrOpts }
      : { count: countOrOpts.count ?? 10, from: countOrOpts.from, max: countOrOpts.max };

  const puuid = await ensureFriendPuuid(friendId);

  // Backfill mode (load all matches since a date), with safety max to avoid timeouts.
  const from = opts.from?.trim();
  const max = Number.isFinite(Number(opts.max)) ? Math.max(1, Math.min(Number(opts.max), 800)) : 180;

  let matchIds: string[] = [];

  if (from) {
    const fromDate = new Date(`${from}T00:00:00Z`);
    if (!Number.isFinite(fromDate.getTime())) {
      throw new Error("Invalid 'from' date. Use YYYY-MM-DD.");
    }

    const startTime = Math.floor(fromDate.getTime() / 1000); // seconds
    const pageSize = 100;

    let start = 0;
    while (matchIds.length < max) {
      const left = max - matchIds.length;
      const page = await getMatchIdsByPuuid(puuid, {
        start,
        count: Math.min(pageSize, left),
        startTime,
      }, { friendId, label: "match/ids/by-puuid" });

      if (!Array.isArray(page) || page.length === 0) break;

      matchIds.push(...page);
      start += page.length;

      if (page.length < Math.min(pageSize, left)) break;
    }

    // De-dupe (just in case)
    matchIds = Array.from(new Set(matchIds));
  } else {
    const count = Number.isFinite(Number(opts.count)) ? Math.max(1, Math.min(Number(opts.count), 50)) : 10;
    matchIds = await getMatchIdsByPuuid(puuid, count, { friendId, label: "match/ids/by-puuid" });
  }

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
      const raw = await getMatchById(matchId, { friendId, label: "match/by-id" });
      const info = raw?.info;

      const gameStartMs =
        typeof info?.gameStartTimestamp === "number" ? BigInt(info.gameStartTimestamp) : null;
      const gameDurationS = typeof info?.gameDuration === "number" ? info.gameDuration : null;
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

      await upsertParticipants(matchId, raw);
    } else {
      // If match was fetched in older versions but participants table is empty,
      // rebuild participants from existing rawJson WITHOUT calling Riot again.
      const pcount = await prisma.matchParticipant.count({ where: { matchId } });
      if (pcount < 10) {
        if (existing && hasMatchPayload(existing.rawJson)) {
          await upsertParticipants(matchId, existing.rawJson);
        } else {
          const raw = await getMatchById(matchId, { friendId, label: "match/by-id" });
          await prisma.match.update({
            where: { id: matchId },
            data: { rawJson: raw, fetchedAt: new Date() },
          });
          await upsertParticipants(matchId, raw);
        }
      }
    }

    if (fetchTimeline) {
      const current = existing ?? (await prisma.match.findUnique({ where: { id: matchId } }));
      const shouldFetchTimeline =
        !current?.timelineJson || !current?.timelineFetchedAt || !isFresh(current.timelineFetchedAt);

      if (shouldFetchTimeline) {
        const timeline = await getMatchTimelineById(matchId, { friendId, label: "match/timeline" });
        await prisma.match.update({
          where: { id: matchId },
          data: { timelineJson: timeline, timelineFetchedAt: new Date() },
        });
      }
    }
  }

  await prisma.friend.update({
    where: { id: friendId },
    data: { lastMatchId: matchIds[0] ?? null, lastSyncAt: new Date() },
  });

  return { puuid, matchIds };
}
