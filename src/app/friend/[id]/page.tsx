"use client";

import { useEffect, useMemo, useState } from "react";
import { fileToAvatarDataUrl } from "@/lib/avatar";

type Friend = {
  id: string;
  riotName: string;
  riotTag: string;
  puuid: string | null;
  avatarUrl: string | null;
};

type ApiMatch = {
  matchId: string;
  gameStartMs: string | null;
  gameDurationS: number | null;
  queueId: number | null;
  raw: any;
};

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? "M").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "D").toUpperCase();
  return a + b;
}

function fmtDuration(s?: number | null) {
  if (!s || !Number.isFinite(s)) return "n/a";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

function displayName(p: any) {
  const gn = p?.riotIdGameName;
  const tl = p?.riotIdTagline;
  if (gn && tl) return `${gn}#${tl}`;
  return p?.summonerName ?? "Unknown";
}

export default function FriendPage({ params }: { params: { id: string } }) {
  const [friend, setFriend] = useState<Friend | null>(null);
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  async function loadAll() {
    setLoading(true);
    const [fRes, mRes] = await Promise.all([
      fetch(`/api/friends/${params.id}`, { cache: "no-store" }),
      fetch(`/api/friends/${params.id}/matches`, { cache: "no-store" }),
    ]);
    const fJson = await fRes.json().catch(() => ({}));
    const mJson = await mRes.json().catch(() => ({}));
    if (!fRes.ok) throw new Error(fJson.error ?? "Impossible de charger le profil.");
    setFriend(fJson);
    setMatches(Array.isArray(mJson) ? mJson : []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll().catch((e) => {
      setToast({ type: "err", msg: e.message });
      setLoading(false);
    });
  }, [params.id]);

  async function syncAll() {
    // Global sync, then refresh this profile
    setBusy(true);
    setToast(null);
    const res = await fetch(`/api/sync?count=10`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) setToast({ type: "err", msg: json.error ?? "Erreur sync" });
    else setToast({ type: "ok", msg: `Sync global OK ✅ (${json.okCount}/${json.total})` });
    await loadAll().catch(() => {});
    setBusy(false);
  }

  async function updateAvatar(file?: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file, 128, 0.82);
      if (dataUrl.length > 180_000) throw new Error("Avatar trop lourd après compression.");
      const res = await fetch(`/api/friends/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });
      if (!res.ok) throw new Error("Impossible d'enregistrer l'avatar.");
      setToast({ type: "ok", msg: "Avatar mis à jour ✨" });
      await loadAll();
    } catch (e: any) {
      setToast({ type: "err", msg: e?.message ?? "Erreur avatar" });
    } finally {
      setBusy(false);
    }
  }

  const derived = useMemo(() => {
    if (!friend?.puuid) return { kpis: null, rows: [] as any[] };

    const rows = matches
      .map((m) => {
        const info = m.raw?.info;
        const parts = info?.participants;
        if (!Array.isArray(parts)) return null;

        const me = parts.find((x: any) => x?.puuid === friend.puuid);
        if (!me) return null;

        const teamId = me.teamId;
        const allies = parts.filter((p: any) => p?.teamId === teamId);
        const enemies = parts.filter((p: any) => p?.teamId !== teamId);

        const date = info?.gameStartTimestamp
          ? new Date(info.gameStartTimestamp).toLocaleString()
          : (m.gameStartMs ? new Date(Number(m.gameStartMs)).toLocaleString() : "n/a");

        const duration = typeof info?.gameDuration === "number" ? info.gameDuration : m.gameDurationS;
        const cs = (me.totalMinionsKilled ?? 0) + (me.neutralMinionsKilled ?? 0);

        const teamKills = (arr: any[]) => arr.reduce((s, p) => s + (p.kills ?? 0), 0);
        const teamDeaths = (arr: any[]) => arr.reduce((s, p) => s + (p.deaths ?? 0), 0);
        const allyKills = teamKills(allies);
        const enemyKills = teamKills(enemies);

        return {
          matchId: m.matchId,
          date,
          duration,
          queueId: info?.queueId ?? m.queueId ?? null,
          win: !!me.win,
          champ: me.championName ?? "Unknown",
          lane: me.lane ?? "—",
          role: me.role ?? "—",
          k: me.kills ?? 0,
          d: me.deaths ?? 0,
          a: me.assists ?? 0,
          cs,
          vision: me.visionScore ?? null,
          dmg: me.totalDamageDealtToChampions ?? null,
          allyKills,
          enemyKills,
          allies: allies.map((p: any) => ({
            name: displayName(p),
            champ: p.championName ?? "—",
            k: p.kills ?? 0,
            d: p.deaths ?? 0,
            a: p.assists ?? 0,
          })),
          enemies: enemies.map((p: any) => ({
            name: displayName(p),
            champ: p.championName ?? "—",
            k: p.kills ?? 0,
            d: p.deaths ?? 0,
            a: p.assists ?? 0,
          })),
        };
      })
      .filter(Boolean) as any[];

    const games = rows.length || 0;
    const wins = rows.filter((r) => r.win).length;
    const winrate = games ? Math.round((wins / games) * 100) : 0;

    const avg = (key: "k" | "d" | "a") => (games ? rows.reduce((s, r) => s + r[key], 0) / games : 0);
    const k = avg("k");
    const d = avg("d");
    const a = avg("a");
    const kda = d > 0 ? (k + a) / d : (k + a);

    return { kpis: { games, wins, winrate, kda }, rows };
  }, [friend, matches]);

  return (
    <main className="container">
      <header className="topbar">
        <div className="brand">
          <a className="button" href="/">←</a>

          <div className="avatar">
            {friend?.avatarUrl ? <img src={friend.avatarUrl} alt="Avatar" /> : <span>{initials(friend?.riotName ?? "Monkey")}</span>}
          </div>

          <div>
            <h1 className="h1" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span>{friend ? `${friend.riotName}#${friend.riotTag}` : "Profil"}</span>
              {friend?.puuid ? <span className="badge">PUUID OK</span> : <span className="badge">PUUID en attente</span>}
            </h1>
            <p className="p">Résumé + détails des games (alliés / ennemis, KDA, etc.).</p>
          </div>
        </div>

        <div className="row">
          <label className="button">
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => updateAvatar(e.target.files?.[0] ?? null)} />
            Changer avatar
          </label>
          <button className="button buttonPrimary" onClick={syncAll} disabled={busy}>
            {busy ? "…" : "Sync tout"}
          </button>
        </div>
      </header>

      {toast && (
        <div style={{ marginTop: 12 }} className="small">
          <span
            className="pill"
            style={{
              borderColor: toast.type === "ok" ? "rgba(52,211,153,.35)" : "rgba(251,113,133,.38)",
              background: toast.type === "ok" ? "rgba(52,211,153,.10)" : "rgba(251,113,133,.10)",
              color: "rgba(255,255,255,.88)",
            }}
          >
            {toast.msg}
          </span>
        </div>
      )}

      <div style={{ marginTop: 14 }} className="grid">
        <section className="card">
          <h2 className="cardTitle">Résumé (10 derniers matchs en DB)</h2>

          {!friend?.puuid ? (
            <p className="small">
              Clique <b>Sync tout</b> pour résoudre le compte (PUUID) et récupérer les matchs.
            </p>
          ) : derived.kpis ? (
            <div className="kpiGrid">
              <div className="kpi">
                <div className="label">Games</div>
                <div className="value">{derived.kpis.games}</div>
              </div>
              <div className="kpi">
                <div className="label">Winrate</div>
                <div className="value">{derived.kpis.winrate}%</div>
              </div>
              <div className="kpi">
                <div className="label">KDA</div>
                <div className="value">{Number(derived.kpis.kda).toFixed(2)}</div>
              </div>
            </div>
          ) : (
            <p className="small">Pas de données.</p>
          )}
        </section>

        <section className="card">
          <h2 className="cardTitle">Games — équipes & KDA</h2>

          {loading ? (
            <p className="small">Chargement…</p>
          ) : derived.rows.length === 0 ? (
            <p className="small">Aucune game stockée. Lance un sync.</p>
          ) : (
            <div className="grid" style={{ marginTop: 8 }}>
              {derived.rows.map((r: any) => (
                <div key={r.matchId} className="match">
                  <div className="matchTop">
                    <div className={`pill ${r.win ? "win" : "lose"}`}>{r.win ? "VICTOIRE" : "DÉFAITE"}</div>
                    <div className="pill">{r.champ}</div>
                    <div className="pill">{fmtDuration(r.duration)}</div>
                    <div className="pill">{r.date}</div>
                    <div className="pill">Kills: <b style={{ marginLeft: 6 }}>{r.allyKills}-{r.enemyKills}</b></div>
                  </div>

                  <div className="row" style={{ gap: 10 }}>
                    <span className="pill">Ton KDA: <b style={{ marginLeft: 6 }}>{r.k}/{r.d}/{r.a}</b></span>
                    <span className="pill">CS: <b style={{ marginLeft: 6 }}>{r.cs}</b></span>
                    {r.vision != null && <span className="pill">Vision: <b style={{ marginLeft: 6 }}>{r.vision}</b></span>}
                    {r.dmg != null && <span className="pill">DMG: <b style={{ marginLeft: 6 }}>{r.dmg}</b></span>}
                    <span className="pill">{r.lane}{r.role && r.role !== "—" ? ` · ${r.role}` : ""}</span>
                  </div>

                  <div className="hr" />

                  <div className="grid" style={{ gap: 10 }}>
                    <div>
                      <div className="small" style={{ marginBottom: 6, opacity: 0.9 }}>Alliés</div>
                      <div className="grid" style={{ gap: 8 }}>
                        {r.allies.map((p: any, idx: number) => (
                          <div key={idx} className="row" style={{ justifyContent: "space-between" }}>
                            <span className="pill">{p.champ}</span>
                            <span className="small" style={{ flex: 1, marginLeft: 10 }}>{p.name}</span>
                            <span className="pill">KDA <b style={{ marginLeft: 6 }}>{p.k}/{p.d}/{p.a}</b></span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="small" style={{ marginBottom: 6, opacity: 0.9 }}>Ennemis</div>
                      <div className="grid" style={{ gap: 8 }}>
                        {r.enemies.map((p: any, idx: number) => (
                          <div key={idx} className="row" style={{ justifyContent: "space-between" }}>
                            <span className="pill">{p.champ}</span>
                            <span className="small" style={{ flex: 1, marginLeft: 10 }}>{p.name}</span>
                            <span className="pill">KDA <b style={{ marginLeft: 6 }}>{p.k}/{p.d}/{p.a}</b></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="small" style={{ marginTop: 14 }}>
        Anti-quota : on lisse les appels (délai minimum) et en cas de 429 on attend automatiquement (Retry-After).
      </p>
    </main>
  );
}
