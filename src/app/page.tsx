"use client";

import { useEffect, useMemo, useState } from "react";
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



  async function syncAll() {
    setBusy(true);
    pushToast("info", "Sync global en cours… (si quota Riot → attente automatique)");
    const res = await fetch(`/api/sync?count=10`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) pushToast("err", json.error ?? "Erreur sync global");
    else pushToast("ok", `Sync OK ✅ (${json.okCount}/${json.total})`);
    await loadOverview().catch(() => {});
    setBusy(false);
  }

  async function backfillAll2026() {
    setBusy(true);
    pushToast("info", "Backfill global depuis 2026… (peut être long / quota Riot)");
    const res = await fetch(`/api/sync?from=2026-01-01&max=250`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) pushToast("err", json.error ?? "Erreur backfill global");
    else pushToast("ok", `Backfill OK ✅ (${json.okCount}/${json.total})`);
    await loadOverview().catch(() => {});
    setBusy(false);
  }

  const filtered = useMemo(() => {
    const list = friends ?? [];
    const qq = q.trim().toLowerCase();

    const base = qq
      ? list.filter((f) => `${f.riotName}#${f.riotTag}`.toLowerCase().includes(qq))
      : list;

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
            <p className="p">
              Overview : rank/LP, winrate ranked, dernière game — + sync auto (cron) côté serveur.
            </p>
          </div>
        </div>

        <div className="row">
          <div className="navlinks">
            <a className="smallLink" href="/synergy">Synergie</a>
          </div>
          <button className="button buttonPrimary" onClick={syncAll} disabled={busy || (friends?.length ?? 0) === 0}>
            {busy ? "…" : "Sync tout"}
          </button>
          <button className="button" onClick={backfillAll2026} disabled={busy || (friends?.length ?? 0) === 0}>
            {busy ? "…" : "Backfill 2026"}
          </button>
          <span className="badge">Next.js · Prisma · PostgreSQL</span>
        </div>
      </header>

      <div style={{ marginTop: 14 }} className="grid cols2">
        <section className="card">
          <h2 className="cardTitle">Actions</h2>

          <div className="grid" style={{ gap: 10 }}>
            <a className="button buttonPrimary" href="/add">
              + Ajouter un monkey
            </a>

            <div className="rowCard">
              <div className="name" style={{ fontSize: 14 }}>Conseils</div>
              <div className="sub" style={{ marginTop: 4 }}>
                • Anti-quota Riot : délai min + retry automatique (429 Retry-After).<br />
                • Le sync global récupère rank + derniers matchs (données complètes + participants).
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="cardTitle" style={{ marginBottom: 0 }}>Monkeys</h2>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" style={{ width: 220 }} placeholder="Recherche…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                      <div className="name">{f.riotName}#{f.riotTag}</div>
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
                          <b>{queueLabel(f.lastGame.queueId)}</b> · {f.lastGame.champ ?? "—"} · {f.lastGame.win ? "W" : "L"} ·{" "}
                          {f.lastGame.kda ?? "—"} · {fmtWhen(f.lastGame.gameStartMs)}
                        </div>
                      ) : (
                        <div className="sub">Aucune game en DB (sync)</div>
                      )}

                      {f.lastGame?.matchId && (
                        <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                          <a className="button" href={`/friend/${f.id}`}>Stats</a>
                          <a className="button" href={`/match/${f.lastGame.matchId}`}>Match</a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
