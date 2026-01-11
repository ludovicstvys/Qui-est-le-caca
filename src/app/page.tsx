"use client";

import { useEffect, useMemo, useState } from "react";
import { fileToAvatarDataUrl } from "@/lib/avatar";
import { formatRank, winrate } from "@/lib/rank";

type Friend = {
  id: string;
  riotName: string;
  riotTag: string;
  puuid?: string | null;
  avatarUrl?: string | null;
  rankedSoloTier?: string | null;
  rankedSoloRank?: string | null;
  rankedSoloLP?: number | null;
  rankedSoloWins?: number | null;
  rankedSoloLosses?: number | null;
};

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? "M").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "D").toUpperCase();
  return a + b;
}

export default function HomePage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [riotName, setRiotName] = useState("");
  const [riotTag, setRiotTag] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  const canSubmit = useMemo(
    () => riotName.trim().length > 0 && riotTag.trim().length > 0,
    [riotName, riotTag]
  );

  async function loadFriends() {
    const res = await fetch("/api/friends", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load friends");
    setFriends(json);
  }

  useEffect(() => {
    loadFriends().catch((e) => setToast({ type: "err", msg: e.message }));
  }, []);

  async function addFriend() {
    if (!canSubmit) return;
    setBusy(true);
    setToast(null);

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
      setToast({ type: "err", msg: json.error ?? "Erreur add friend" });
      setBusy(false);
      return;
    }

    setRiotName("");
    setRiotTag("");
    setAvatarUrl(null);
    await loadFriends();
    setToast({ type: "ok", msg: "Monkey ajouté ✨" });
    setBusy(false);
  }

  async function syncAll() {
    setBusy(true);
    setToast(null);
    const res = await fetch(`/api/sync?count=10`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) setToast({ type: "err", msg: json.error ?? "Erreur sync global" });
    else setToast({ type: "ok", msg: `Sync global OK ✅ (${json.okCount}/${json.total})` });
    setBusy(false);
  }

  async function onPickAvatar(file?: File | null) {
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file, 128, 0.82);
      if (dataUrl.length > 180_000) {
        setToast({ type: "err", msg: "Avatar trop lourd après compression. Essaie une autre image." });
        return;
      }
      setAvatarUrl(dataUrl);
      setToast({ type: "ok", msg: "Avatar prêt ✅" });
    } catch (e: any) {
      setToast({ type: "err", msg: e?.message ?? "Erreur avatar" });
    }
  }

  return (
    <main className="container">
      <header className="topbar">
        <div className="brand">
          <div className="avatar" aria-hidden>
            <span>MD</span>
          </div>
          <div>
            <h1 className="h1">Monkeys dashboard</h1>
            <p className="p">Stats LoL (dark) — rank, LP & winrate ranked — Riot API + SQL + cache.</p>
          </div>
        </div>

        <div className="row">
          <button className="button buttonPrimary" onClick={syncAll} disabled={busy || friends.length === 0}>
            {busy ? "…" : "Sync tout"}
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
            <span className="small">Le sync global récupère / met à jour les 10 derniers matchs de tout le monde.</span>
          </div>

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

          <p className="small" style={{ marginTop: 10 }}>
            Quota Riot : si tu touches les limites, le serveur attend automatiquement (Retry-After + backoff).
          </p>
        </section>

        <section className="card">
          <h2 className="cardTitle">Monkeys</h2>

          {friends.length === 0 ? (
            <p className="small">Aucun monkey pour l’instant. Ajoute-en un à gauche 👈</p>
          ) : (
            <div className="grid" style={{ marginTop: 8 }}>
              {friends.map((f) => (
                <div key={f.id} className="friendCard">
                  <div className="avatar">
                    {f.avatarUrl ? <img src={f.avatarUrl} alt={`${f.riotName} avatar`} /> : <span>{initials(f.riotName)}</span>}
                  </div>

                  <div>
                    <div className="name">{f.riotName}#{f.riotTag}</div>
                    <div className="sub">{f.puuid ? "Compte lié ✅" : "Compte pas encore résolu (sync) ⏳"}</div>
                    <div className="sub" style={{ marginTop: 6 }}>
                      Solo: <b>{formatRank(f.rankedSoloTier ?? null, f.rankedSoloRank ?? null, f.rankedSoloLP ?? null)}</b>
                      {winrate(f.rankedSoloWins ?? null, f.rankedSoloLosses ?? null) != null && (
                        <> · WR <b>{winrate(f.rankedSoloWins ?? null, f.rankedSoloLosses ?? null)}%</b> ({f.rankedSoloWins ?? 0}-{f.rankedSoloLosses ?? 0})</>
                      )}
                    </div>

                  </div>

                  <div className="spacer" />

                  <a className="button" href={`/friend/${f.id}`}>Voir stats</a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
