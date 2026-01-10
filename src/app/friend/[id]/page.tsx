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
  const a = (parts[0]?.[0] ?? "L").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "F").toUpperCase();
  return a + b;
}

function fmtDuration(s?: number | null) {
  if (!s || !Number.isFinite(s)) return "n/a";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}m ${r.toString().padStart(2, "0")}s`;
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
    if (!fRes.ok) throw new Error("Impossible de charger le profil.");
    const fJson = await fRes.json();
    const mJson = await mRes.json();
    setFriend(fJson);
    setMatches(mJson);
    setLoading(false);
  }

  useEffect(() => {
    loadAll().catch((e) => {
      setToast({ type: "err", msg: e.message });
      setLoading(false);
    });
  }, [params.id]);

  async function syncNow() {
    setBusy(true);
    setToast(null);
    const res = await fetch(`/api/friends/${params.id}/sync`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) setToast({ type: "err", msg: json.error ?? "Erreur sync" });
    else setToast({ type: "ok", msg: "Sync OK ✅" });
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
        const p = parts.find((x: any) => x?.puuid === friend.puuid);
        if (!p) return null;

        const date = info?.gameStartTimestamp
          ? new Date(info.gameStartTimestamp).toLocaleString()
          : (m.gameStartMs ? new Date(Number(m.gameStartMs)).toLocaleString() : "n/a");

        const duration = typeof info?.gameDuration === "number" ? info.gameDuration : m.gameDurationS;
        const cs = (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0);

        return {
          matchId: m.matchId,
          date,
          duration,
          win: !!p.win,
          champ: p.championName ?? "Unknown",
          lane: p.lane ?? "—",
          role: p.role ?? "—",
          k: p.kills ?? 0,
          d: p.deaths ?? 0,
          a: p.assists ?? 0,
          cs,
          vision: p.visionScore ?? null,
          dmg: p.totalDamageDealtToChampions ?? null,
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
            {friend?.avatarUrl ? <img src={friend.avatarUrl} alt="Avatar" /> : <span>{initials(friend?.riotName ?? "LoL")}</span>}
          </div>

          <div>
            <h1 className="h1" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span>{friend ? `${friend.riotName}#${friend.riotTag}` : "Profil"}</span>
              {friend?.puuid ? <span className="badge">PUUID OK</span> : <span className="badge">PUUID en attente</span>}
            </h1>
            <p className="p">Stats rapides + derniers matchs stockés en base.</p>
          </div>
        </div>

        <div className="row">
          <label className="button">
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => updateAvatar(e.target.files?.[0] ?? null)} />
            Changer avatar
          </label>
          <button className="button buttonPrimary" onClick={syncNow} disabled={busy}>
            {busy ? "…" : "Sync"}
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
          <h2 className="cardTitle">Résumé (10 derniers matchs)</h2>

          {!friend?.puuid ? (
            <p className="small">
              Clique <b>Sync</b> pour résoudre le compte (PUUID) et récupérer les matchs.
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
          <h2 className="cardTitle">Derniers matchs</h2>

          {loading ? (
            <p className="small">Chargement…</p>
          ) : derived.rows.length === 0 ? (
            <p className="small">Aucun match stocké. Lance un sync.</p>
          ) : (
            <div className="grid" style={{ marginTop: 8 }}>
              {derived.rows.map((r: any) => (
                <div key={r.matchId} className="match">
                  <div className="matchTop">
                    <div className={`pill ${r.win ? "win" : "lose"}`}>{r.win ? "VICTOIRE" : "DÉFAITE"}</div>
                    <div className="pill">{r.champ}</div>
                    <div className="pill">{fmtDuration(r.duration)}</div>
                    <div className="pill">{r.date}</div>
                  </div>

                  <div className="row" style={{ gap: 10 }}>
                    <span className="pill">KDA: <b style={{ marginLeft: 6 }}>{r.k}/{r.d}/{r.a}</b></span>
                    <span className="pill">CS: <b style={{ marginLeft: 6 }}>{r.cs}</b></span>
                    {r.vision != null && <span className="pill">Vision: <b style={{ marginLeft: 6 }}>{r.vision}</b></span>}
                    {r.dmg != null && <span className="pill">DMG: <b style={{ marginLeft: 6 }}>{r.dmg}</b></span>}
                    <span className="pill">{r.lane}{r.role && r.role !== "—" ? ` · ${r.role}` : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <p className="small" style={{ marginTop: 14 }}>
        Note : l’avatar est stocké en DB en Data URL (compressé) pour rester simple.
      </p>
    </main>
  );
}
