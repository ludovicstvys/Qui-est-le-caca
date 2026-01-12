"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToAvatarDataUrl } from "@/lib/avatar";
import { ToastHost, Toast } from "@/components/ToastHost";

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? "M").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "K").toUpperCase();
  return a + b;
}

export default function AddMonkeyPage() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
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

  const canSubmit = useMemo(() => {
    const n = riotName.trim();
    const t = riotTag.trim();
    return n.length >= 2 && t.length >= 2;
  }, [riotName, riotTag]);

  async function onPickAvatar(file?: File | null) {
    if (!file) return;
    try {
      setBusy(true);
      const dataUrl = await fileToAvatarDataUrl(file, 128, 0.82);
      setAvatarUrl(dataUrl);
    } catch (e: any) {
      pushToast("err", e?.message ?? "Erreur avatar");
    } finally {
      setBusy(false);
    }
  }

  async function addFriend() {
    if (!canSubmit) return;
    setBusy(true);
    try {
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
      if (!res.ok) throw new Error(json.error ?? "Erreur ajout monkey");
      pushToast("ok", "Monkey ajouté ✅");
      // Small reset for UX; then go back.
      setRiotName("");
      setRiotTag("");
      setAvatarUrl(null);
      router.push("/");
      router.refresh();
    } catch (e: any) {
      pushToast("err", e?.message ?? "Erreur ajout");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <ToastHost toasts={toasts} remove={removeToast} />

      <header className="topbar">
        <div className="brand">
          <div className="avatar" aria-hidden>
            <span>+</span>
          </div>
          <div>
            <h1 className="h1">Ajouter un monkey</h1>
            <p className="p">Ajoute une nouvelle personne au dashboard.</p>
          </div>
        </div>

        <div className="row">
          <a className="button" href="/">Retour</a>
          <button className="button buttonPrimary" disabled={!canSubmit || busy} onClick={addFriend}>
            {busy ? "…" : "Ajouter"}
          </button>
        </div>
      </header>

      <div className="grid cols2" style={{ marginTop: 14 }}>
        <section className="card">
          <h2 className="cardTitle">Identité Riot</h2>

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

          <p className="small" style={{ marginTop: 10 }}>
            Astuce : le tagLine est la partie après le <code>#</code> dans Riot ID.
          </p>
        </section>

        <section className="card">
          <h2 className="cardTitle">Avatar (optionnel)</h2>

          <div className="row">
            <div className="avatar" title="Aperçu avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" />
              ) : (
                <span>{initials(riotName || "Monkey")}</span>
              )}
            </div>

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

          <p className="small">
            Après l’ajout, utilise <b>Sync tout</b> sur le dashboard pour récupérer le rank et les derniers matchs.
          </p>
        </section>
      </div>
    </main>
  );
}
