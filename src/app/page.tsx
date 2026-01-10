"use client";

import { useEffect, useMemo, useState } from "react";
import { fileToAvatarDataUrl } from "@/lib/avatar";

type Friend = {
  id: string;
  riotName: string;
  riotTag: string;
  puuid?: string | null;
  avatarUrl?: string | null;
};

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? "L").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "F").toUpperCase();
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
    if (!res.ok) throw new Error("Failed to load friends");
    setFriends(await res.json());
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
    setToast({ type: "ok", msg: "Ami ajouté ✨" });
    setBusy(false);
  }

  async function sync(friendId: string) {
    setBusy(true);
    setToast(null);

    const res = await fetch(`/api/friends/${friendId}/sync`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) setToast({ type: "err", msg: json.error ?? "Erreur sync" });
    else setToast({ type: "ok", msg: "Sync OK (10 matchs) ✅" });

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
            <span>LF</span>
          </div>
          <div>
            <h1 className="h1">LoL Friends</h1>
            <p className="p">Dashboard dark pour suivre les games de tes potes (Riot API + SQL).</p>
          </div>
        </div>
        <span className="badge">Next.js · Prisma · PostgreSQL</span>
      </header>

      <div style={{ marginTop: 14 }} className="grid cols2">
        <section className="card">
          <h2 className="cardTitle">Ajouter un pote</h2>

          <div className="row">
            <div className="avatar" title="Aperçu avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" />
              ) : (
                <span>{initials(riotName || "LoL Friend")}</span>
              )}
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
              placeholder="gameName (ex: MyFriend)"
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
            <span className="small">Le sync va récupérer/stocker 10 matchs par défaut.</span>
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
            Tip : tu peux rester en privé avec une clé Riot dev (24h), ou demander une clé “personal” pour être plus
            stable.
          </p>
        </section>

        <section className="card">
          <h2 className="cardTitle">Potes</h2>

          {friends.length === 0 ? (
            <p className="small">Aucun pote pour l’instant. Ajoute-en un à gauche 👈</p>
          ) : (
            <div className="grid" style={{ marginTop: 8 }}>
              {friends.map((f) => (
                <div key={f.id} className="friendCard">
                  <div className="avatar">
                    {f.avatarUrl ? (
                      <img src={f.avatarUrl} alt={`${f.riotName} avatar`} />
                    ) : (
                      <span>{initials(f.riotName)}</span>
                    )}
                  </div>

                  <div>
                    <div className="name">{f.riotName}#{f.riotTag}</div>
                    <div className="sub">{f.puuid ? "Compte lié ✅" : "Compte pas encore résolu (sync) ⏳"}</div>
                  </div>

                  <div className="spacer" />

                  <button className="button" onClick={() => sync(f.id)} disabled={busy}>
                    Sync 10 matchs
                  </button>
                  <a className="button" href={`/friend/${f.id}`}>Voir</a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
