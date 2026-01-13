"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatRank, winrate, bestRankScore } from "@/lib/rank";
import { queueLabel } from "@/lib/queues";
import { Skeleton } from "@/components/Skeleton";
import { ToastHost, Toast } from "@/components/ToastHost";

type OverviewFriend = {
  id: string;
  riotName: string;
  riotTag: string;
  puuid?: string | null;
  avatarUrl?: string | null;

  lastMatchId?: string | null;
  lastSyncAt?: string | null;

  rankedSoloTier?: string | null;
  rankedSoloRank?: string | null;
  rankedSoloLP?: number | null;
  rankedSoloWins?: number | null;
  rankedSoloLosses?: number | null;

  rankedFlexTier?: string | null;
  rankedFlexRank?: string | null;
  rankedFlexLP?: number | null;
  rankedFlexWins?: number | null;
  rankedFlexLosses?: number | null;

  lastGame?: {
    matchId: string;
    queueId: number | null;
    gameStartMs: string | null;
    gameDurationS: number | null;
    champ: string | null;
    win: boolean | null;
    kda: string | null;
  } | null;
};

type SyncResponse = {
  ok: boolean;
  okCount?: number;
  total?: number;
  error?: string;
  done?: boolean;
  nextDelayMs?: number;
  pending?: { matchDetails: number; backfillFriends: number };
  progress?: { friendsProcessed: number; detailsFetched: number; elapsedMs: number; budgetMs: number; stoppedEarly: boolean };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? "M").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "D").toUpperCase();
  return a + b;
}

function fmtWhen(ms?: string | null) {
  if (!ms) return "n/a";
  const d = new Date(Number(ms));
  return d.toLocaleString();
}

function fmtAgo(iso?: string | null) {
  if (!iso) return "jamais";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "à l’instant";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const days = Math.floor(h / 24);
  return `${days}j`;
}

export default function HomePage() {
  const [friends, setFriends] = useState<OverviewFriend[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"lp" | "wr" | "last" | "name">("lp");

  const [toasts, setToasts] = useState<Toast[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const [loop, setLoop] = useState<{
    label: string;
    run: number;
    pending?: { matchDetails: number; backfillFriends: number };
  } | null>(null);

  function pushToast(type: Toast["type"], msg: string) {
    setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, type, msg }]);
  }
  function removeToast(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  const wrOf = (f: OverviewFriend) =>
    winrate(f.rankedSoloWins ?? null, f.rankedSoloLosses ?? null) ??
    winrate(f.rankedFlexWins ?? null, f.rankedFlexLosses ?? null);

  async function loadOverview() {
    const res = await fetch("/api/overview", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load overview");
    setFriends(json);
  }

  useEffect(() => {
    loadOverview().catch((e) => pushToast("err", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopLoop() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      pushToast("info", "Stop demandé.");
    }
  }

  async function runLoop(url: string, label: string) {
    if (busy) return;

    const ac = new AbortController();
    abortRef.current = ac;

    setBusy(true);
    setLoop({ label, run: 0 });
    pushToast("info", `${label}…`);

    try {
      for (let i = 1; i <= 10_000; i++) {
        if (ac.signal.aborted) break;

        const res = await fetch(url, { method: "POST", signal: ac.signal });
        const json = (await res.json().catch(() => ({}))) as SyncResponse;

        if (!res.ok || !json.ok) {
          pushToast("err", json.error ?? "Erreur sync");
          break;
        }

        setLoop({ label, run: i, pending: json.pending });

        // Refresh UI regularly (but not every tick)
        if (i === 1 || i % 2 === 0 || (json.progress?.detailsFetched ?? 0) > 0) {
          await loadOverview().catch(() => {});
        }

        if (json.done) {
          pushToast("ok", `${label} terminé ✅`);
          break;
        }

        const delay = typeof json.nextDelayMs === "number" ? Math.max(250, Math.min(json.nextDelayMs, 5000)) : 800;
        await sleep(delay);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") pushToast("err", e?.message ?? "Erreur");
    } finally {
      abortRef.current = null;
      setLoop(null);
      setBusy(false);
      await loadOverview().catch(() => {});
    }
  }

  async function syncAll() {
    await runLoop(`/api/sync?mode=latest&count=10`, "Sync tout");
  }

  async function backfillAll2026() {
    await runLoop(`/api/sync?from=2026-01-01&max=250&count=10`, "Backfill 2026");
  }

  const filtered = useMemo(() => {
    const list = friends ?? [];
    const qq = q.trim().toLowerCase();

    const base = qq ? list.filter((f) => `${f.riotName}#${f.riotTag}`.toLowerCase().includes(qq)) : list;

    const cmp = (a: OverviewFriend, b: OverviewFriend) => {
      if (sort === "name") return `${a.riotName}#${a.riotTag}`.localeCompare(`${b.riotName}#${b.riotTag}`);
      if (sort === "last") {
        const aa = a.lastGame?.gameStartMs ? Number(a.lastGame.gameStartMs) : 0;
        const bb = b.lastGame?.gameStartMs ? Number(b.lastGame.gameStartMs) : 0;
        return bb - aa;
      }
      if (sort === "wr") {
        const aw = wrOf(a) ?? -1;
        const bw = wrOf(b) ?? -1;
        if (bw !== aw) return bw - aw;
        return bestRankScore(b) - bestRankScore(a);
      }
      // lp
      const as = bestRankScore(a);
      const bs = bestRankScore(b);
      if (bs !== as) return bs - as;
      const aw = wrOf(a) ?? -1;
      const bw = wrOf(b) ?? -1;
      return bw - aw;
    };

    return [...base].sort(cmp);
  }, [friends, q, sort]);

  return (
    <main className="container">
      <ToastHost toasts={toasts} remove={removeToast} />

      <header className="topbar">
        <div className="brand">
          <div className="avatar" aria-hidden>
            <span>MD</span>
          </div>
          <div>
            <h1 className="h1">Monkeys dashboard</h1>
            <p className="p">Overview : rank/LP, winrate ranked, dernière game — + sync budgeté sans timeout.</p>
          </div>
        </div>

        <div className="row">
          <div className="navlinks">
            <a className="smallLink" href="/synergy">
              Synergie
            </a>
          </div>

          <a className="button buttonPrimary" href="/add">
            + add
          </a>

          <button className="button" onClick={syncAll} disabled={busy || (friends?.length ?? 0) === 0}>
            {busy && loop?.label === "Sync tout" ? `… (${loop.run})` : "Sync tout"}
          </button>

          <button className="button" onClick={backfillAll2026} disabled={busy || (friends?.length ?? 0) === 0}>
            {busy && loop?.label === "Backfill 2026" ? `… (${loop.run})` : "Backfill 2026"}
          </button>

          {busy && (
            <button className="button buttonDanger" onClick={stopLoop}>
              Stop
            </button>
          )}

          {loop?.pending ? (
            <span className="badge">
              run {loop.run} · pending details {loop.pending.matchDetails} · pending backfill {loop.pending.backfillFriends}
            </span>
          ) : (
            <span className="badge">Next.js · Prisma · PostgreSQL</span>
          )}
        </div>
      </header>

      {/* Keep the Monkeys card aligned with the top dashboard card width */}
      <section className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="cardTitle" style={{ marginBottom: 0 }}>
              Monkeys
            </h2>
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ width: 220 }}
                placeholder="Recherche…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="lp">Tri: LP</option>
                <option value="wr">Tri: Winrate</option>
                <option value="last">Tri: Dernière game</option>
                <option value="name">Tri: Nom</option>
              </select>
            </div>
          </div>

          {friends === null ? (
            <div className="grid" style={{ marginTop: 10 }}>
              <Skeleton style={{ height: 72 }} />
              <Skeleton style={{ height: 72 }} />
              <Skeleton style={{ height: 72 }} />
            </div>
          ) : friends.length === 0 ? (
            <p className="small" style={{ marginTop: 10 }}>
              Aucun monkey. <a className="smallLink" href="/add">Ajoute-en un ici</a>.
            </p>
          ) : (
            <div className="grid" style={{ marginTop: 10 }}>
              {filtered.map((f) => {
                const soloGames = (f.rankedSoloWins ?? 0) + (f.rankedSoloLosses ?? 0);
                const flexGames = (f.rankedFlexWins ?? 0) + (f.rankedFlexLosses ?? 0);
                const wrSolo = winrate(f.rankedSoloWins ?? null, f.rankedSoloLosses ?? null);
                const wrFlex = winrate(f.rankedFlexWins ?? null, f.rankedFlexLosses ?? null);
                const useSoloWr = soloGames > 0 || (soloGames === 0 && flexGames === 0);
                const wr = useSoloWr ? wrSolo : wrFlex;
                const wrLabel = useSoloWr ? "Solo" : "Flex";
                const wins = useSoloWr ? (f.rankedSoloWins ?? 0) : (f.rankedFlexWins ?? 0);
                const losses = useSoloWr ? (f.rankedSoloLosses ?? 0) : (f.rankedFlexLosses ?? 0);

                return (
                  <div key={f.id} className="friendCard">
                    <div className="avatar">
                      {f.avatarUrl ? <img src={f.avatarUrl} alt={`${f.riotName} avatar`} /> : <span>{initials(f.riotName)}</span>}
                    </div>

                    <div className="friendCardSection">
                      <div className="name">
                        {f.riotName}#{f.riotTag}
                      </div>
                      <div className="sub" style={{ marginTop: 2 }}>
                        Solo: <b>{formatRank(f.rankedSoloTier ?? null, f.rankedSoloRank ?? null, f.rankedSoloLP ?? null)}</b>
                      </div>
                      <div className="sub" style={{ marginTop: 2 }}>
                        Flex: <b>{formatRank(f.rankedFlexTier ?? null, f.rankedFlexRank ?? null, f.rankedFlexLP ?? null)}</b>
                      </div>
                      {wr != null && (
                        <div className="sub" style={{ marginTop: 2 }}>
                          WR Ranked ({wrLabel}): <b>{wr}%</b> ({wins}-{losses})
                        </div>
                      )}
                      <div className="sub" style={{ marginTop: 4 }}>
                        Dernière sync: <b>{fmtAgo(f.lastSyncAt ?? null)}</b>
                      </div>
                    </div>

                    <div className="friendCardSection">
                      {f.lastGame ? (
                        <div className="sub">
                          <b>{queueLabel(f.lastGame.queueId)}</b> · {f.lastGame.champ ?? "—"} · {f.lastGame.win ? "W" : "L"} · {" "}
                          {f.lastGame.kda ?? "—"} · {fmtWhen(f.lastGame.gameStartMs)}
                        </div>
                      ) : (
                        <div className="sub">Aucune game en DB (détails en cours…)</div>
                      )}

                      {f.lastGame?.matchId && (
                        <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                          <a className="button" href={`/friend/${f.id}`}>
                            Stats
                          </a>
                          <a className="button" href={`/match/${f.lastGame.matchId}`}>
                            Match
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </section>
    </main>
  );
}
