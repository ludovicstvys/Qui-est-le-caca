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
