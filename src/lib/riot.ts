const RIOT_API_KEY = process.env.RIOT_API_KEY!;
const RIOT_REGION = (process.env.RIOT_REGION || "euw1").toLowerCase();      // platform routing: euw1
const RIOT_ROUTING = (process.env.RIOT_ROUTING || "europe").toLowerCase();  // regional routing: europe

function assertEnv() {
  if (!RIOT_API_KEY) throw new Error("Missing RIOT_API_KEY");
}

async function riotFetch<T>(url: string): Promise<T> {
  assertEnv();

  const res = await fetch(url, {
    headers: { "X-Riot-Token": RIOT_API_KEY },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot API error ${res.status} ${res.statusText} - ${text}`);
  }
  return (await res.json()) as T;
}

// Account-v1 (regional routing)
export async function getAccountByRiotId(gameName: string, tagLine: string) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
  )}/${encodeURIComponent(tagLine)}`;
  return riotFetch<{ puuid: string; gameName: string; tagLine: string }>(url);
}

// Match-v5 (regional routing)
export async function getMatchIdsByPuuid(puuid: string, count = 10) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(
    puuid
  )}/ids?start=0&count=${count}`;
  return riotFetch<string[]>(url);
}

export async function getMatchById(matchId: string) {
  const url = `https://${RIOT_ROUTING}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return riotFetch<any>(url);
}

// Summoner-v4 (platform routing) - optional if you want level/icon/etc
export async function getSummonerByPuuid(puuid: string) {
  const url = `https://${RIOT_REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(
    puuid
  )}`;
  return riotFetch<any>(url);
}
