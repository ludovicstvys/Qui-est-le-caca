const RIOT_API_KEY = process.env.RIOT_API_KEY!;
const RIOT_REGION = (process.env.RIOT_REGION || "euw1").toLowerCase();      // platform routing: euw1
const RIOT_ROUTING = (process.env.RIOT_ROUTING || "europe").toLowerCase();  // regional routing: europe
const RIOT_MIN_DELAY_MS = Number(process.env.RIOT_MIN_DELAY_MS || "140");

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

async function riotFetch<T>(url: string, attempt = 0): Promise<T> {
  return withQueue(async () => {
    assertEnv();
    await throttle();

  const res = await fetch(url, {
    headers: { "X-Riot-Token": RIOT_API_KEY },
    cache: "no-store",
  });

  // Rate limit: retry with delay (Retry-After if present), then exponential backoff.
  if (res.status === 429) {
    const retryAfterS = parseRetryAfterSeconds(res);
    const base = retryAfterS != null ? retryAfterS * 1000 : 800 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 250);
    const delay = Math.min(base + jitter, 15_000);

    if (attempt < 5) {
      await sleep(delay);
      return riotFetch<T>(url, attempt + 1);
    }
  }

  // Transient errors: retry a bit
  if (res.status >= 500 && res.status < 600 && attempt < 3) {
    const delay = Math.min(600 * Math.pow(2, attempt) + Math.floor(Math.random() * 200), 5_000);
    await sleep(delay);
    return riotFetch<T>(url, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot API error ${res.status} ${res.statusText} - ${text}`);
  }

  return (await res.json()) as T;
  });
}

// Account-v1 (regional routing)
export async function getAccountByRiotId(gameName: string, tagLine: string) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
  )}/${encodeURIComponent(tagLine)}`;
  return riotFetch<{ puuid: string; gameName: string; tagLine: string }>(url);
}

// Match-v5 (regional routing)
export async function getMatchIdsByPuuid(
  puuid: string,
  countOrOpts: number | { start?: number; count?: number; startTime?: number; endTime?: number } = 10
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
  return riotFetch<string[]>(url);
}

export async function getMatchById(matchId: string) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetch<any>(url);
}

export async function getMatchTimelineById(matchId: string) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(
    matchId
  )}/timeline`;
  return riotFetch<any>(url);
}

// Summoner-v4 (platform routing) - optional if you want level/icon/etc
export async function getSummonerByPuuid(puuid: string) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(
    puuid
  )}`;
  return riotFetch<any>(url);
}

// League-v4 (platform routing): current season ranked entries
export async function getLeagueEntriesBySummonerId(encryptedSummonerId: string) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(
    encryptedSummonerId
  )}`;
  return riotFetch<any[]>(url);
}
