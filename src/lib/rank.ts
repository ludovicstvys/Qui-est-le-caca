export type RankedQueueKey = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

export type RankInfo = {
  tier: string | null;
  rank: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
};

export function pickRank(entries: any[], queueType: RankedQueueKey): RankInfo {
  const e = Array.isArray(entries) ? entries.find((x) => x?.queueType === queueType) : null;
  if (!e) return { tier: null, rank: null, lp: null, wins: null, losses: null };
  return {
    tier: e.tier ?? null,
    rank: e.rank ?? null,
    lp: typeof e.leaguePoints === "number" ? e.leaguePoints : null,
    wins: typeof e.wins === "number" ? e.wins : null,
    losses: typeof e.losses === "number" ? e.losses : null,
  };
}

export function winrate(wins?: number | null, losses?: number | null) {
  const w = wins ?? 0;
  const l = losses ?? 0;
  const t = w + l;
  if (t <= 0) return null;
  return Math.round((w / t) * 100);
}

export function formatRank(tier?: string | null, div?: string | null, lp?: number | null) {
  if (!tier) return "Unranked";
  const d = div ? ` ${div}` : "";
  const p = lp != null ? ` · ${lp} LP` : "";
  return `${tier}${d}${p}`;
}

// --- Sorting helpers (Tier > Division > LP) ---
const TIER_ORDER: Record<string, number> = {
  IRON: 1,
  BRONZE: 2,
  SILVER: 3,
  GOLD: 4,
  PLATINUM: 5,
  EMERALD: 6,
  DIAMOND: 7,
  MASTER: 8,
  GRANDMASTER: 9,
  CHALLENGER: 10,
};

const DIV_ORDER: Record<string, number> = {
  IV: 1,
  III: 2,
  II: 3,
  I: 4,
};

function normTier(t?: string | null) {
  return (t ?? "").trim().toUpperCase();
}

function normDiv(r?: string | null) {
  return (r ?? "").trim().toUpperCase();
}

/**
 * Returns a comparable score where higher means "better".
 * Unranked => -1.
 */
export function rankScore(tier?: string | null, div?: string | null, lp?: number | null) {
  const t = normTier(tier);
  const tierN = TIER_ORDER[t] ?? 0;
  if (tierN <= 0) return -1;

  // Master+ have no division; we treat div as max.
  const isApex = t === "MASTER" || t === "GRANDMASTER" || t === "CHALLENGER";
  const divN = isApex ? 4 : (DIV_ORDER[normDiv(div)] ?? 0);
  const lpN = typeof lp === "number" ? lp : 0;

  // Tier is dominant, then division, then LP
  return tierN * 1_000_000 + divN * 10_000 + lpN;
}

export function bestRankScore(r: {
  rankedSoloTier?: string | null;
  rankedSoloRank?: string | null;
  rankedSoloLP?: number | null;
  rankedFlexTier?: string | null;
  rankedFlexRank?: string | null;
  rankedFlexLP?: number | null;
}) {
  const solo = rankScore(r.rankedSoloTier ?? null, r.rankedSoloRank ?? null, r.rankedSoloLP ?? null);
  const flex = rankScore(r.rankedFlexTier ?? null, r.rankedFlexRank ?? null, r.rankedFlexLP ?? null);
  return Math.max(solo, flex);
}
