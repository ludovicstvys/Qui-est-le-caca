"use client";

import { useEffect, useState } from "react";

type Friend = {
  id: string;
  riotName: string;
  riotTag: string;
  puuid?: string | null;
};

export default function HomePage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [riotName, setRiotName] = useState("");
  const [riotTag, setRiotTag] = useState("");

  async function loadFriends() {
    const res = await fetch("/api/friends");
    if (!res.ok) throw new Error("Failed to load friends");
    setFriends(await res.json());
  }

  useEffect(() => {
    loadFriends().catch((e) => alert(e.message));
  }, []);

  async function addFriend() {
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ riotName, riotTag }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Erreur add friend");
      return;
    }

    setRiotName("");
    setRiotTag("");
    await loadFriends();
  }

  async function sync(friendId: string) {
    const res = await fetch(`/api/friends/${friendId}/sync`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) alert(json.error ?? "Erreur sync");
    else alert("Sync OK");
  }

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: 0 }}>LoL Friends Dashboard</h1>
      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Ajoute des Riot IDs (gameName#tagLine), puis sync pour stocker les matchs en SQL.
      </p>

      <section style={{ marginTop: 18, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Ajouter un pote</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="gameName"
            value={riotName}
            onChange={(e) => setRiotName(e.target.value)}
          />
          <input
            placeholder="tagLine (ex: EUW)"
            value={riotTag}
            onChange={(e) => setRiotTag(e.target.value)}
          />
          <button onClick={addFriend}>Ajouter</button>
        </div>
        <p style={{ marginBottom: 0, opacity: 0.75, marginTop: 10 }}>
          Exemple : <code>Faker#KR1</code> (selon la région, il faudra ajuster RIOT_ROUTING/REGION).
        </p>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Mes potes</h2>
        {friends.length === 0 ? (
          <p>Aucun pote pour l’instant.</p>
        ) : (
          <ul style={{ paddingLeft: 18 }}>
            {friends.map((f) => (
              <li key={f.id} style={{ marginBottom: 10 }}>
                <b>{f.riotName}#{f.riotTag}</b> {f.puuid ? "✅" : "⏳"}
                <button style={{ marginLeft: 10 }} onClick={() => sync(f.id)}>
                  Sync 10 matchs
                </button>
                <a style={{ marginLeft: 10, textDecoration: "underline" }} href={`/friend/${f.id}`}>
                  Voir
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
