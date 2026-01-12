import { getPrisma } from "@/lib/prisma";
import { getMatchById, getMatchIdsByPuuid } from "@/lib/riot";
import { ensureFriendPuuid, syncFriendRank, upsertParticipants } from "@/lib/sync";

export type SyncMode = "latest" | "backfill";

export type RunSyncOptions = {
  mode?: SyncMode;
  /** Backfill lower bound (YYYY-MM-DD). Only used when mode="backfill" (or when provided). */
  from?: string;
  /** Max matchIds to link per friend *for this run* (soft cap). */
  max?: number;
  /** Max friends to process for this run. */
  count?: number;
  /** If set, sync only this friend. */
  friendId?: string;
};

export type FriendSyncResult = {
  friendId: string;
  riot: string;
  ok: boolean;
  error?: string;
  rank?: { skipped: boolean };
  matchesLinked?: number;
  matchIdsPages?: number;
  detailsFetched?: number;
  stoppedEarly?: boolean;
};

function clampInt(v: any, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

function parseFromDateToSeconds(from?: string | null) {
  if (!from) return null;
  const d = new Date(`${from}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function shouldStop(startedAt: number, budgetMs: number) {
  // keep a small buffer so we return before serverless hard timeout
  return Date.now() - startedAt >= Math.max(1, budgetMs - 1500);
}

async function ensureFriendSyncState(friendId: string) {
  const prisma = getPrisma();
  return prisma.friendSyncState.upsert({
    where: { friendId },
    update: {},
    create: { friendId },
  });
}

async function acquireFriendLock(friendId: string, ttlMs = 5 * 60_000) {
  const prisma = getPrisma();
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);

  await ensureFriendSyncState(friendId);

  const updated = await prisma.friendSyncState.updateMany({
    where: {
      friendId,
      OR: [{ syncLockUntil: null }, { syncLockUntil: { lt: now } }],
    },
    data: { syncLockUntil: until },
  });

  return updated.count === 1;
}

async function releaseFriendLock(friendId: string) {
  const prisma = getPrisma();
  await prisma.friendSyncState
    .update({
      where: { friendId },
      data: { syncLockUntil: new Date() },
    })
    .catch(() => {});
}

async function linkMatchIds(friendId: string, opts: { mode: SyncMode; fromSeconds?: number | null; maxPerRun: number; maxPages: number; timeBudget: { startedAt: number; budgetMs: number } }) {
  const prisma = getPrisma();
  const friend = await prisma.friend.findUnique({ where: { id: friendId } });
  if (!friend) throw new Error("Friend not found");

  const puuid = await ensureFriendPuuid(friendId);

  let linked = 0;
  let pages = 0;

  if (opts.mode === "latest") {
    const ids = await getMatchIdsByPuuid(
      puuid,
      { start: 0, count: Math.max(1, Math.min(100, opts.maxPerRun)) },
      { friendId, label: "match/ids/by-puuid" }
    );

    // 1) create placeholders for matches
    await prisma.match.createMany({
      data: ids.map((id) => ({ id, rawJson: {}, fetchedAt: new Date(0) })),
      skipDuplicates: true,
    });

    // 2) link friend<->match
    await prisma.friendMatch.createMany({
      data: ids.map((matchId) => ({ friendId, matchId })),
      skipDuplicates: true,
    });

    linked = ids.length;
    pages = 1;

    await prisma.friend.update({
      where: { id: friendId },
      data: { lastMatchId: ids[0] ?? null, lastSyncAt: new Date() },
    });

    await ensureFriendSyncState(friendId);
    await prisma.friendSyncState.update({
      where: { friendId },
      data: { lastRunAt: new Date() },
    });

    return { linked, pages };
  }

  // backfill
  const state0 = await ensureFriendSyncState(friendId);
  const fromSeconds = opts.fromSeconds;
  if (!fromSeconds) {
    throw new Error("Backfill requires a valid 'from' date (YYYY-MM-DD).");
  }

  const sameFrom = state0.backfillFromTs != null && BigInt(fromSeconds) === BigInt(state0.backfillFromTs);
  const endSeconds = (() => {
    if (sameFrom && state0.backfillEndTs != null) return Number(state0.backfillEndTs);
    return Math.floor(Date.now() / 1000);
  })();

  // If 'from' changed, reset cursor/done and freeze endTs.
  const state = await prisma.friendSyncState.update({
    where: { friendId },
    data: sameFrom
      ? { backfillFromTs: BigInt(fromSeconds), backfillEndTs: BigInt(endSeconds) }
      : {
          backfillFromTs: BigInt(fromSeconds),
          backfillEndTs: BigInt(endSeconds),
          matchlistCursorStart: 0,
          matchlistDone: false,
        },
  });

  let cursor = state.matchlistCursorStart;
  let done = state.matchlistDone;

  const pageSize = 100;

  while (!done && pages < opts.maxPages && linked < opts.maxPerRun) {
    if (shouldStop(opts.timeBudget.startedAt, opts.timeBudget.budgetMs)) break;

    const left = opts.maxPerRun - linked;
    const count = Math.min(pageSize, left);

    const ids = await getMatchIdsByPuuid(
      puuid,
      { start: cursor, count, startTime: fromSeconds, endTime: endSeconds },
      { friendId, label: "match/ids/by-puuid" }
    );

    pages += 1;

    if (!Array.isArray(ids) || ids.length === 0) {
      done = true;
      break;
    }

    await prisma.match.createMany({
      data: ids.map((id) => ({ id, rawJson: {}, fetchedAt: new Date(0) })),
      skipDuplicates: true,
    });

    await prisma.friendMatch.createMany({
      data: ids.map((matchId) => ({ friendId, matchId })),
      skipDuplicates: true,
    });

    linked += ids.length;
    cursor += ids.length;

    if (ids.length < count) {
      done = true;
      break;
    }
  }

  await prisma.friendSyncState.update({
    where: { friendId },
    data: { matchlistCursorStart: cursor, matchlistDone: done, lastRunAt: new Date() },
  });

  await prisma.friend.update({
    where: { id: friendId },
    data: { lastSyncAt: new Date() },
  });

  return { linked, pages };
}

async function fetchMatchDetails(matchIds: string[], timeBudget: { startedAt: number; budgetMs: number }) {
  const prisma = getPrisma();

  let fetched = 0;
  for (const matchId of matchIds) {
    if (shouldStop(timeBudget.startedAt, timeBudget.budgetMs)) break;

    const existing = await prisma.match.findUnique({ where: { id: matchId } });

    // If already fetched (has in-game timestamp), skip.
    if (existing?.gameStartMs != null) continue;

    const raw = await getMatchById(matchId, { label: "match/by-id" });
    const info = raw?.info;

    const gameStartMs = typeof info?.gameStartTimestamp === "number" ? BigInt(info.gameStartTimestamp) : null;
    const gameDurationS = typeof info?.gameDuration === "number" ? info.gameDuration : null;
    const queueId = typeof info?.queueId === "number" ? info.queueId : null;
    const platform = typeof info?.platformId === "string" ? info.platformId : null;

    // Ensure row exists
    if (!existing) {
      await prisma.match.create({
        data: {
          id: matchId,
          rawJson: raw,
          platform,
          gameStartMs,
          gameDurationS,
          queueId,
          fetchedAt: new Date(),
        },
      });
    } else {
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

    await upsertParticipants(matchId, raw);
    fetched += 1;
  }

  return fetched;
}

export async function runSync(options: RunSyncOptions = {}) {
  const prisma = getPrisma();

  const startedAt = Date.now();
  const budgetMs = clampInt(process.env.SYNC_TIME_BUDGET_MS, 240_000, 30_000, 290_000);
  const timeBudget = { startedAt, budgetMs };

  const fromSeconds = parseFromDateToSeconds(options.from ?? null);
  const mode: SyncMode = options.from ? "backfill" : (options.mode ?? "latest");

  const maxFriends = clampInt(options.count ?? process.env.SYNC_MAX_FRIENDS_PER_RUN, 5, 1, 50);
  const maxIdPagesPerFriend = clampInt(process.env.SYNC_MATCH_ID_PAGES_PER_FRIEND, 1, 0, 10);
  const maxMatchIdsPerFriendPerRun = clampInt(options.max ?? process.env.SYNC_MAX_MATCH_IDS_PER_FRIEND_PER_RUN, 100, 1, 5000);

  // Global cap (not per friend)
  const maxDetailsPerRun = clampInt(process.env.MATCH_DETAILS_PER_RUN ?? process.env.SYNC_MAX_MATCH_DETAILS_PER_RUN, 15, 0, 400);

  const results: FriendSyncResult[] = [];
  const processedFriendIds: string[] = [];

  const pickFriends = async () => {
    if (options.friendId) {
      const f = await prisma.friend.findUnique({ where: { id: options.friendId }, include: { syncState: true } });
      return f ? [f] : [];
    }

    const friends = await prisma.friend.findMany({ include: { syncState: true } });

    if (mode === "backfill") {
      const withWork = friends.filter((f) => {
        const st = f.syncState;
        if (!st) return true;
        if (!st.matchlistDone) return true;
        // If 'from' changed, we consider it work.
        if (fromSeconds != null && st.backfillFromTs != null && BigInt(fromSeconds) !== BigInt(st.backfillFromTs)) return true;
        if (fromSeconds != null && st.backfillFromTs == null) return true;
        return false;
      });

      withWork.sort((a, b) => {
        const aa = a.syncState?.updatedAt?.getTime() ?? 0;
        const bb = b.syncState?.updatedAt?.getTime() ?? 0;
        return aa - bb;
      });

      return withWork.slice(0, maxFriends);
    }

    // latest: refresh oldest lastSyncAt first
    friends.sort((a, b) => {
      const aa = a.lastSyncAt?.getTime() ?? 0;
      const bb = b.lastSyncAt?.getTime() ?? 0;
      return aa - bb;
    });

    return friends.slice(0, maxFriends);
  };

  const friendsToSync = await pickFriends();

  for (const f of friendsToSync) {
    if (shouldStop(startedAt, budgetMs)) break;

    const riot = `${f.riotName}#${f.riotTag}`;

    const res: FriendSyncResult = { friendId: f.id, riot, ok: true };

    let locked = false;
    try {
      locked = await acquireFriendLock(f.id);
      if (!locked) {
        res.ok = true;
        res.stoppedEarly = true;
        res.error = "Friend locked (another sync in progress)";
        results.push(res);
        continue;
      }

      // A) Rank
      const rr = await syncFriendRank(f.id);
      res.rank = { skipped: (rr as any)?.skipped === true };

      // B) Match IDs
      const idPages = maxIdPagesPerFriend;
      const { linked, pages } = await linkMatchIds(f.id, {
        mode,
        fromSeconds,
        maxPerRun: maxMatchIdsPerFriendPerRun,
        maxPages: idPages,
        timeBudget,
      });
      res.matchesLinked = linked;
      res.matchIdsPages = pages;

      processedFriendIds.push(f.id);
    } catch (e: any) {
      res.ok = false;
      res.error = e?.message ?? "Unknown error";
    } finally {
      if (locked) await releaseFriendLock(f.id);
      results.push(res);
    }
  }

  // C) Fetch match details (global cap)
  let detailsFetched = 0;
  const remainingDetails = Math.max(0, maxDetailsPerRun);

  if (remainingDetails > 0 && !shouldStop(startedAt, budgetMs)) {
    // 1) Prioritize matches linked to processed friends
    const fm1 = processedFriendIds.length
      ? await prisma.friendMatch.findMany({
          where: {
            friendId: { in: processedFriendIds },
            match: { gameStartMs: null },
          },
          orderBy: { addedAt: "desc" },
          take: remainingDetails * 4,
          select: { matchId: true },
        })
      : [];

    const unique = (arr: Array<{ matchId: string }>) => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const x of arr) {
        if (!seen.has(x.matchId)) {
          seen.add(x.matchId);
          out.push(x.matchId);
        }
      }
      return out;
    };

    let candidates = unique(fm1);

    // 2) If we still have room, pick globally (keeps backfill progressing)
    if (candidates.length < remainingDetails) {
      const fm2 = await prisma.friendMatch.findMany({
        where: { match: { gameStartMs: null } },
        orderBy: { addedAt: "desc" },
        take: remainingDetails * 6,
        select: { matchId: true },
      });
      for (const id of unique(fm2)) {
        if (candidates.length >= remainingDetails) break;
        if (!candidates.includes(id)) candidates.push(id);
      }
    }

    candidates = candidates.slice(0, remainingDetails);

    detailsFetched = await fetchMatchDetails(candidates, timeBudget);
  }

  // Distribute detail counts into friend results (best-effort)
  for (const r of results) {
    r.detailsFetched = detailsFetched;
  }

  const okCount = results.filter((r) => r.ok).length;
  const stoppedEarly = shouldStop(startedAt, budgetMs);

  return {
    ok: true,
    mode,
    from: options.from ?? null,
    count: maxFriends,
    total: results.length,
    okCount,
    results,
    progress: {
      friendsProcessed: processedFriendIds.length,
      detailsFetched,
      elapsedMs: Date.now() - startedAt,
      budgetMs,
      stoppedEarly,
    },
  };
}
