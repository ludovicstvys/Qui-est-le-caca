"use client";

import { useEffect, useMemo, useState } from "react";
import { queueLabel } from "@/lib/queues";
import { Skeleton } from "@/components/Skeleton";
import { ToastHost, Toast } from "@/components/ToastHost";

type Part = {
  puuid: string;
  teamId: number | null;
  win: boolean | null;
  name: string;
  champ: string | null;
  lane: string | null;
  role: string | null;
  k: number | null;
  d: number | null;
  a: number | null;
  cs: number;
  vision: number | null;
  dmg: number | null;
  gold: number | null;
};

type MatchPayload = {
  matchId: string;
  platform: string | null;
  queueId: number | null;
  gameStartMs: string | null;
  gameDurationS: number | null;
  teams: Array<{ teamId: number; kills: number; deaths: number; assists: number; gold: number; dmg: number }>;
  friends: Array<{ id: string; riot: string; puuid: string | null }>;
  participants: Part[];
};

function fmtWhen(ms?: string | null) {
  if (!ms) return "n/a";
  const d = new Date(Number(ms));
  return d.toLocaleString();
}
function fmtDur(s?: number | null) {
  if (!s) return "n/a";
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}m ${String(ss).padStart(2, "0")}s`;
}

export default function MatchPage({ params }: { params: { matchId: string } }) {
  const [data, setData] = useState<MatchPayload | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(type: Toast["type"], msg: string) {
    setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, type, msg }]);
  }
  function removeToast(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  useEffect(() => {
    // Fetch timeline on-demand (cached in DB after first view)
    fetch(`/api/matches/${params.matchId}?includeTimeline=1`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ r, j })))
      .then(({ r, j }) => {
        if (!r.ok) throw new Error(j.error ?? "Match introuvable");
        setData(j);
      })
      .catch((e) => pushToast("err", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.matchId]);

  const byTeam = useMemo(() => {
    if (!data) return [];
    const teams = Array.from(new Set(data.participants.map((p) => p.teamId).filter((x): x is number => typeof x === "number")));
    return teams.map((tid) => ({
      teamId: tid,
      players: data.participants.filter((p) => p.teamId === tid),
      sum: data.teams.find((t) => t.teamId === tid) ?? null,
    }));
  }, [data]);

  const friendPuuids = useMemo(() => new Set((data?.friends ?? []).map((f) => f.puuid).filter(Boolean) as string[]), [data]);

  return (
    <main className="container">
      <ToastHost toasts={toasts} remove={removeToast} />

      <header className="topbar">
        <div className="brand">
          <div className="avatar" aria-hidden>
            <span>MD</span>
          </div>
          <div>
            <h1 className="h1">Match</h1>
            <p className="p">
              {data ? (
                <>
                  <b>{queueLabel(data.queueId)}</b> · {fmtDur(data.gameDurationS)} · {fmtWhen(data.gameStartMs)}
                </>
              ) : (
                "Chargement…"
              )}
            </p>
          </div>
        </div>

        <div className="row">
          <a className="button" href="/">Dashboard</a>
        </div>
      </header>

      {!data ? (
        <div className="grid" style={{ marginTop: 14 }}>
          <Skeleton style={{ height: 220 }} />
          <Skeleton style={{ height: 220 }} />
        </div>
      ) : (
        <div className="grid cols2" style={{ marginTop: 14 }}>
          {byTeam.map((t) => (
            <section key={t.teamId} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 className="cardTitle" style={{ marginBottom: 0 }}>
                  Team {t.teamId}
                </h2>
                {t.sum && (
                  <div className="badge">
                    K/D/A {t.sum.kills}/{t.sum.deaths}/{t.sum.assists} · Gold {t.sum.gold} · DMG {t.sum.dmg}
                  </div>
                )}
              </div>

              <div className="hr" />

              <div className="grid" style={{ gap: 10 }}>
                {t.players.map((p) => {
                  const isMonkey = friendPuuids.has(p.puuid);
                  return (
                    <div key={p.puuid} className="rowCard">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div style={{ minWidth: 220 }}>
                          <div className="name" style={{ fontSize: 14 }}>
                            {isMonkey ? "🐒 " : ""}{p.name}
                          </div>
                          <div className="sub" style={{ marginTop: 2 }}>
                            {p.champ ?? "—"} · {p.lane ?? "—"} · {p.role ?? "—"} · {p.win ? "Win" : "Lose"}
                          </div>
                        </div>
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <span className="pill">KDA <b style={{ marginLeft: 6 }}>{p.k ?? 0}/{p.d ?? 0}/{p.a ?? 0}</b></span>
                          {p.dmg != null && <span className="pill">DMG <b style={{ marginLeft: 6 }}>{p.dmg}</b></span>}
                          {p.gold != null && <span className="pill">Gold <b style={{ marginLeft: 6 }}>{p.gold}</b></span>}
                          <span className="pill">CS <b style={{ marginLeft: 6 }}>{p.cs}</b></span>
                          {p.vision != null && <span className="pill">Vision <b style={{ marginLeft: 6 }}>{p.vision}</b></span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {t.players.some((p) => friendPuuids.has(p.puuid)) && (
                <p className="small" style={{ marginTop: 12 }}>
                  🐒 = un de tes monkeys présents dans la game.
                </p>
              )}
            </section>
          ))}
        </div>
      )}

      {data?.friends?.length ? (
        <section className="card" style={{ marginTop: 14 }}>
          <h2 className="cardTitle">Monkeys présents</h2>
          <div className="row" style={{ gap: 10 }}>
            {data.friends.map((f) => (
              <a key={f.id} className="button" href={`/friend/${f.id}`}>{f.riot}</a>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
