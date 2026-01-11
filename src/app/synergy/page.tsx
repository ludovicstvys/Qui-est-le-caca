"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/Skeleton";
import { ToastHost, Toast } from "@/components/ToastHost";

type Pair = {
  a: string;
  b: string;
  games: number;
  wins: number;
  winrate: number;
};

export default function SynergyPage() {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function pushToast(type: Toast["type"], msg: string) {
    setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, type, msg }]);
  }
  function removeToast(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  useEffect(() => {
    fetch("/api/synergy?take=800", { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ r, j })))
      .then(({ r, j }) => {
        if (!r.ok) throw new Error(j.error ?? "Failed to load synergy");
        setPairs(j.pairs ?? []);
      })
      .catch((e) => pushToast("err", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const best = useMemo(() => (pairs ?? []).slice(0, 30), [pairs]);

  return (
    <main className="container">
      <ToastHost toasts={toasts} remove={removeToast} />

      <header className="topbar">
        <div className="brand">
          <div className="avatar" aria-hidden>
            <span>MD</span>
          </div>
          <div>
            <h1 className="h1">Synergie</h1>
            <p className="p">Quand 2 monkeys jouent ensemble (même équipe) : games + winrate.</p>
          </div>
        </div>

        <div className="row">
          <a className="button" href="/">Retour</a>
        </div>
      </header>

      <section className="card" style={{ marginTop: 14 }}>
        <h2 className="cardTitle">Top duos</h2>

        {pairs === null ? (
          <div className="grid">
            <Skeleton style={{ height: 60 }} />
            <Skeleton style={{ height: 60 }} />
            <Skeleton style={{ height: 60 }} />
          </div>
        ) : pairs.length === 0 ? (
          <p className="small">Pas assez de données. Lance un Sync tout puis reviens 👈</p>
        ) : (
          <div className="grid" style={{ gap: 10 }}>
              {best.map((p, idx) => (
                <div key={idx} className="rowCard">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div className="name" style={{ fontSize: 14 }}>
                        <b>{p.a}</b> + <b>{p.b}</b>
                      </div>
                      <div className="sub">{p.games} games · {p.wins}-{p.games - p.wins}</div>
                    </div>
                    <div className="badge">WR <b style={{ marginLeft: 6 }}>{p.winrate}%</b></div>
                  </div>
                </div>
              ))}
            </div>
        )}

        <p className="small" style={{ marginTop: 10 }}>
          Calcul basé sur les participants en DB (matchs déjà synchronisés).
        </p>
      </section>
    </main>
  );
}
