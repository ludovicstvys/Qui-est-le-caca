const RIOT_API_KEY = process.env.RIOT_API_KEY!;
const RIOT_REGION = (process.env.RIOT_REGION || "euw1").toLowerCase();      // platform routing: euw1
const RIOT_ROUTING = (process.env.RIOT_ROUTING || "europe").toLowerCase();  // regional routing: europe
const RIOT_MIN_DELAY_MS = Number(process.env.RIOT_MIN_DELAY_MS || "140");
const DEBUG_RIOT = (() => {
  const v = String(process.env.DEBUG_RIOT || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
})();

export type RiotDebugCtx = {
  friendId?: string;
  label?: string;
};

function sanitizeUrl(rawUrl: string) {
  // Riot API key is sent in headers, but keep this in case a query param is ever added.
  try {
    const u = new URL(rawUrl);
    if (u.searchParams.has("api_key")) u.searchParams.delete("api_key");
    if (u.searchParams.has("X-Riot-Token")) u.searchParams.delete("X-Riot-Token");
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function debugLog(ctx: RiotDebugCtx | undefined, msg: string, extra?: Record<string, any>) {
  if (!DEBUG_RIOT) return;
  const prefix = `[DEBUG_RIOT]${ctx?.friendId ? ` friendId=${ctx.friendId}` : ""}${ctx?.label ? ` label=${ctx.label}` : ""}`;
  if (extra) {
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${msg}`, extra);
  } else {
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${msg}`);
  }
}

function assertEnv() {
  if (!RIOT_API_KEY) throw new Error("Missing RIOT_API_KEY");
}

// Soft throttling to smooth bursts (helps with quota).
// Default: ~140ms between requests in the SAME function invocation (configurable via RIOT_MIN_DELAY_MS).
let lastReqAt = 0;

// Promise queue => ensures calls are serialized inside a single invocation
let inFlight: Promise<void> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle() {
  const now = Date.now();
  const minDelay = Number.isFinite(RIOT_MIN_DELAY_MS) ? Math.max(0, RIOT_MIN_DELAY_MS) : 140;
  const wait = Math.max(0, minDelay - (now - lastReqAt));
  if (wait > 0) await sleep(wait);
  lastReqAt = Date.now();
}

async function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const prev = inFlight;
  inFlight = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}


function parseRetryAfterSeconds(res: Response) {
  const h = res.headers.get("retry-after") ?? res.headers.get("Retry-After");
  if (!h) return null;
  const n = Number(h);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function riotFetch<T>(url: string, attempt = 0, ctx?: RiotDebugCtx): Promise<T> {
  return withQueue(async () => {
    assertEnv();
    await throttle();

    const safeUrl = sanitizeUrl(url);
    debugLog(ctx, `-> ${safeUrl}`);

    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { "X-Riot-Token": RIOT_API_KEY },
      cache: "no-store",
    });

    debugLog(ctx, `<- ${res.status} ${safeUrl}`, { ms: Date.now() - t0 });

  // Rate limit: retry with delay (Retry-After if present), then exponential backoff.
  if (res.status === 429) {
    const retryAfterS = parseRetryAfterSeconds(res);
    const base = retryAfterS != null ? retryAfterS * 1000 : 800 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(base + jitter, 15_000);

    debugLog(ctx, `rate-limited (429) - retry in ${delay}ms`, { attempt, retryAfterS });

    if (attempt < 5) {
      await sleep(delay);
      return riotFetch<T>(url, attempt + 1, ctx);
    }
  }

  // Transient errors: retry a bit
  if (res.status >= 500 && res.status < 600 && attempt < 3) {
    const delay = Math.min(600 * Math.pow(2, attempt) + Math.floor(Math.random() * 200), 5_000);
    await sleep(delay);
    debugLog(ctx, `server error (${res.status}) - retry in ${delay}ms`, { attempt });
    return riotFetch<T>(url, attempt + 1, ctx);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // keep the error readable in logs
    const snippet = (text || "").slice(0, 400);
    debugLog(ctx, `error ${res.status} ${res.statusText}`, { body: snippet });
    throw new Error(`Riot API error ${res.status} ${res.statusText} - ${snippet}`);
  }

  return (await res.json()) as T;
  });
}

// Account-v1 (regional routing)
export async function getAccountByRiotId(gameName: string, tagLine: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
  )}/${encodeURIComponent(tagLine)}`;
  return riotFetch<{ puuid: string; gameName: string; tagLine: string }>(url, 0, ctx);
}

// Match-v5 (regional routing)
export async function getMatchIdsByPuuid(
  puuid: string,
  countOrOpts: number | { start?: number; count?: number; startTime?: number; endTime?: number } = 10,
  ctx?: RiotDebugCtx
) {
  const opts =
    typeof countOrOpts === "number"
      ? { start: 0, count: countOrOpts }
      : { start: countOrOpts.start ?? 0, count: countOrOpts.count ?? 10, startTime: countOrOpts.startTime, endTime: countOrOpts.endTime };

  const params = new URLSearchParams();
  params.set("start", String(opts.start ?? 0));
  params.set("count", String(Math.max(1, Math.min(opts.count ?? 10, 100))));
  if (typeof opts.startTime === "number") params.set("startTime", String(Math.floor(opts.startTime)));
  if (typeof opts.endTime === "number") params.set("endTime", String(Math.floor(opts.endTime)));

  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(
    puuid
  )}/ids?${params.toString()}`;
  return riotFetch<string[]>(url, 0, ctx);
}

export async function getMatchById(matchId: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetch<any>(url, 0, ctx);
}

export async function getMatchTimelineById(matchId: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
    matchId
  )}/timeline`;
  return riotFetch<any>(url, 0, ctx);
}

// Summoner-v4 (platform routing) - optional if you want level/icon/etc
export async function getSummonerByPuuid(puuid: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(
    puuid
  )}`;
  return riotFetch<any>(url, 0, ctx);
}

// Summoner-v4 (platform routing) - deprecated (summonerName), but can be useful as a fallback
// when Summoner-v4 by-puuid returns a partial payload that does not include the encrypted summonerId.
export async function getSummonerByName(summonerName: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(
    summonerName
  )}`;
  return riotFetch<any>(url, 0, ctx);
}

// League-v4 (platform routing): current season ranked entries
export async function getLeagueEntriesBySummonerId(encryptedSummonerId: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(
    encryptedSummonerId
  )}`;
  return riotFetch<any[]>(url, 0, ctx);
}

// League-v4 (platform routing): current season ranked entries by PUUID
// Note: Riot is in the process of migrating away from summonerId/accountId-based endpoints.
// If /entries/by-summoner starts returning 403 for valid tokens, prefer this PUUID variant.
export async function getLeagueEntriesByPuuid(encryptedPuuid: string, ctx?: RiotDebugCtx) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(
    encryptedPuuid
  )}`;
  return riotFetch<any[]>(url, 0, ctx);
}
