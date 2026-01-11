"use client";

import { useEffect, useMemo, useState } from "react";
import { fileToAvatarDataUrl } from "@/lib/avatar";
import { formatRank, winrate } from "@/lib/rank";
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

  // Add friend form
  const [riotName, setRiotName] = useState("");
  const [riotTag, setRiotTag] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(type: Toast["type"], msg: string) {
    setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, type, msg }]);
  }
  function removeToast(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  const canSubmit = useMemo(
    () => riotName.trim().length > 0 && riotTag.trim().length > 0,
    [riotName, riotTag]
  );

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

  async function onPickAvatar(file?: File | null) {
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file, 128, 0.82);
      if (dataUrl.length > 180_000) {
        pushToast("err", "Avatar trop lourd après compression. Essaie une autre image.");
        return;
      }
      setAvatarUrl(dataUrl);
      pushToast("ok", "Avatar prêt ✅");
    } catch (e: any) {
      pushToast("err", e?.message ?? "Erreur avatar");
    }
  }

  async function addFriend() {
    if (!canSubmit) return;
    setBusy(true);

    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        riotName: riotName.trim(),
        riotTag: riotTag.trim(),
        avatarUrl,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushToast("err", json.error ?? "Erreur add friend");
      setBusy(false);
      return;
    }

    setRiotName("");
    setRiotTag("");
    setAvatarUrl(null);
    pushToast("ok", "Monkey ajouté ✨");
    await loadOverview().catch(() => {});
    setBusy(false);
  }

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
        const aw = winrate(a.rankedSoloWins ?? null, a.rankedSoloLosses ?? null) ?? -1;
        const bw = winrate(b.rankedSoloWins ?? null, b.rankedSoloLosses ?? null) ?? -1;
        if (bw !== aw) return bw - aw;
        const alp = a.rankedSoloLP ?? -1;
        const blp = b.rankedSoloLP ?? -1;
        return blp - alp;
      }
      // lp
      const alp = a.rankedSoloLP ?? -1;
      const blp = b.rankedSoloLP ?? -1;
      if (blp !== alp) return blp - alp;
      const aw = winrate(a.rankedSoloWins ?? null, a.rankedSoloLosses ?? null) ?? -1;
      const bw = winrate(b.rankedSoloWins ?? null, b.rankedSoloLosses ?? null) ?? -1;
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
          <h2 className="cardTitle">Ajouter un monkey</h2>

          <div className="row">
            <div className="avatar" title="Aperçu avatar">
              {avatarUrl ? <img src={avatarUrl} alt="Avatar" /> : <span>{initials(riotName || "Monkey")}</span>}
            </div>

            <div className="spacer" />

            <label className="button" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
              />
              Importer avatar
            </label>

            {avatarUrl && (
              <button className="button buttonDanger" onClick={() => setAvatarUrl(null)} disabled={busy}>
                Retirer
              </button>
            )}
          </div>

          <div className="hr" />

          <div className="row">
            <input
              className="input"
              placeholder="gameName (ex: MyMonkey)"
              value={riotName}
              onChange={(e) => setRiotName(e.target.value)}
            />
            <input
              className="input"
              placeholder="tagLine (ex: EUW)"
              value={riotTag}
              onChange={(e) => setRiotTag(e.target.value)}
            />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="button buttonPrimary" disabled={!canSubmit || busy} onClick={addFriend}>
              {busy ? "…" : "Ajouter"}
            </button>
            <span className="small">
              Le sync global récupère rank + 10 derniers matchs (données complètes + participants).
            </span>
          </div>

          <p className="small" style={{ marginTop: 10 }}>
            Anti-quota Riot : délai min + retry automatique (429 Retry-After).
          </p>
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
            <p className="small" style={{ marginTop: 10 }}>Aucun monkey. Ajoute-en un à gauche 👈</p>
          ) : (
            <div className="grid" style={{ marginTop: 10 }}>
              {filtered.map((f) => {
                const wr = winrate(f.rankedSoloWins ?? null, f.rankedSoloLosses ?? null);
                return (
                  <div key={f.id} className="friendCard">
                    <div className="avatar">
                      {f.avatarUrl ? <img src={f.avatarUrl} alt={`${f.riotName} avatar`} /> : <span>{initials(f.riotName)}</span>}
                    </div>

                    <div style={{ minWidth: 220 }}>
                      <div className="name">{f.riotName}#{f.riotTag}</div>
                      <div className="sub" style={{ marginTop: 2 }}>
                        Solo: <b>{formatRank(f.rankedSoloTier ?? null, f.rankedSoloRank ?? null, f.rankedSoloLP ?? null)}</b>
                        {wr != null && (
                          <> · WR <b>{wr}%</b> ({f.rankedSoloWins ?? 0}-{f.rankedSoloLosses ?? 0})</>
                        )}
                      </div>
                      <div className="sub" style={{ marginTop: 4 }}>
                        Dernière sync: <b>{fmtAgo(f.lastSyncAt ?? null)}</b>
                      </div>
                    </div>

                    <div className="spacer" />

                    <div style={{ minWidth: 320 }}>
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
