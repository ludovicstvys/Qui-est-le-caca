"use client";

import { useEffect, useMemo, useState } from "react";

type ApiMatch = {
  matchId: string;
  gameStartMs: string | null;
  gameDurationS: number | null;
  queueId: number | null;
  raw: any;
};

export default function FriendPage({ params }: { params: { id: string } }) {
  const [matches, setMatches] = useState<ApiMatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/friends/${params.id}/matches`);
      const json = await res.json();
      setMatches(json);
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [params.id]);

  const cards = useMemo(() => {
    return matches.map((m) => {
      const info = m.raw?.info;
      const date = info?.gameStartTimestamp
        ? new Date(info.gameStartTimestamp).toLocaleString()
        : (m.gameStartMs ? new Date(Number(m.gameStartMs)).toLocaleString() : "n/a");

      const duration = typeof info?.gameDuration === "number"
        ? info.gameDuration
        : (m.gameDurationS ?? null);

      return {
        matchId: m.matchId,
        date,
        duration,
        queueId: info?.queueId ?? m.queueId ?? "n/a",
        participants: Array.isArray(info?.participants) ? info.participants.length : null,
      };
    });
  }, [matches]);

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <a href="/" style={{ textDecoration: "underline" }}>← Retour</a>
      <h1 style={{ marginBottom: 6 }}>Derniers matchs (stockés en DB)</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Si la liste est vide, clique “Sync 10 matchs” sur la page d’accueil.
      </p>

      {loading ? (
        <p>Chargement…</p>
      ) : cards.length === 0 ? (
        <p>Aucun match trouvé.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 14 }}>
          {cards.map((c) => (
            <li key={c.matchId} style={{ marginBottom: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ fontWeight: 700 }}>{c.matchId}</div>
              <div>Date : {c.date}</div>
              <div>Durée : {c.duration ?? "n/a"}s</div>
              <div>Queue : {c.queueId}</div>
              <div>Participants : {c.participants ?? "n/a"}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
