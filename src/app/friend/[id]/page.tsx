"use client";

import { useEffect, useMemo, useState } from "react";
import { fileToAvatarDataUrl } from "@/lib/avatar";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { queueLabel } from "@/lib/queues";
import { formatRank, winrate } from "@/lib/rank";
import { Skeleton } from "@/components/Skeleton";
import { ToastHost, Toast } from "@/components/ToastHost";

const FROM_2026 = "2026-01-01";

type Friend = {
  id: string;
  riotName: string;
  riotTag: string;
  region: string;
  puuid: string | null;
  avatarUrl: string | null;

  rankedSoloTier?: string | null;
  rankedSoloRank?: string | null;
  rankedSoloLP?: number | null;
  rankedSoloWins?: number | null;
  rankedSoloLosses?: number | null;

  rankedFlexTier?: string | null;
  rankedFlexRank?: string | null;
  rankedFlexLP?: number | null;
  rankedFlexWins?: number | null;
  rankedFlexLosses?: number | null;
};

type Player = {
  puuid: string;
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

type MatchRow = {
  matchId: string;
  gameStartMs: string | null;
  gameDurationS: number | null;
  queueId: number | null;
  win: boolean | null;
  champ: string | null;
  lane: string | null;
  role: string | null;
  k: number | null;
  d: number | null;
  a: number | null;
  cs: number | null;
  vision: number | null;
  dmg: number | null;
  gold: number | null;
  team: {
    allyKills: number;
    enemyKills: number;
    allyGold: number;
    enemyGold: number;
    allyDmg: number;
    enemyDmg: number;
  };
  allies: Player[];
  enemies: Player[];
  participantCount?: number;
};

type Summary = {
  champs: Array<{ champ: string; games: number; wins: number; winrate: number }>;
  lanes: Array<{ lane: string; games: number }>;
  roles: Array<{ role: string; games: number }>;
  sample: number;
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

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  const a = (parts[0]?.[0] ?? "M").toUpperCase();
  const b = (parts[1]?.[0] ?? parts[0]?.[1] ?? "K").toUpperCase();
  return a + b;
}

function kdaStr(k?: number | null, d?: number | null, a?: number | null) {
  return `${k ?? 0}/${d ?? 0}/${a ?? 0}`;
}

export default function FriendPage({ params }: { params: { id: string } }) {
  const [friend, setFriend] = useState<Friend | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  const [take, setTake] = useState(30);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const [toasts, setToasts] = useState<Toast[]>([]);
  function pushToast(type: Toast["type"], msg: string) {
    setToasts((t) => [...t, { id: `${Date.now()}-${Math.random()}`, type, msg }]);
  }
  function removeToast(id: string) {
    setToasts((t) => t.filter((x) => x.id !== id));
  }

  function toggle(matchId: string) {
    setOpen((o) => ({ ...o, [matchId]: !o[matchId] }));
  }

  async function loadAll(nextTake = take) {
    const [f, m, s] = await Promise.all([
      fetch(`/api/friends/${params.id}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/friends/${params.id}/matches?from=${FROM_2026}&take=${nextTake}`, {
        cache: "no-store",
      }).then((r) => r.json()),
      fetch(`/api/friends/${params.id}/summary`, { cache: "no-store" }).then((r) => r.json()),
    ]);

    setFriend(f);
    setMatches(Array.isArray(m) ? m : []);
    setSummary(s?.ok ? s : { champs: [], lanes: [], roles: [], sample: 0 });
  }

  useEffect(() => {
    loadAll().catch((e) => pushToast("err", e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const wr = useMemo(
    () => winrate(friend?.rankedSoloWins ?? null, friend?.rankedSoloLosses ?? null),
    [friend]
  );

  const wrFlex = useMemo(
    () => winrate(friend?.rankedFlexWins ?? null, friend?.rankedFlexLosses ?? null),
    [friend]
  );

  const groupedByDay = useMemo(() => {
    const arr = Array.isArray(matches) ? matches : [];
    const sorted = [...arr].sort((a, b) => {
      const aa = a.gameStartMs ? Number(a.gameStartMs) : 0;
      const bb = b.gameStartMs ? Number(b.gameStartMs) : 0;
      return bb - aa;
    });

    const groups = new Map<string, MatchRow[]>();
    for (const m of sorted) {
      const ms = m.gameStartMs ? Number(m.gameStartMs) : 0;
      const d = ms ? new Date(ms) : null;
      const key = d ? d.toISOString().slice(0, 10) : "unknown";
      const bucket = groups.get(key) ?? [];
      bucket.push(m);
      groups.set(key, bucket);
    }

    const out = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return out.map(([key, items]) => {
      const label =
        key === "unknown"
          ? "Date inconnue"
          : new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            });
      return { key, label, items };
    });
  }, [matches]);

  async function syncLatest() {
    setBusy(true);
    pushToast("info", "Sync du monkey… (rank + derniers matchs)");
    const res = await fetch(`/api/friends/${params.id}/sync?count=12`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) pushToast("err", json.error ?? "Erreur sync");
    else pushToast("ok", "Sync OK ✅");
    await loadAll().catch(() => {});
    setBusy(false);
  }

  async function backfill2026() {
    setBusy(true);
    pushToast("info", `Backfill depuis ${FROM_2026}… (ça peut prendre un peu)`);
    const res = await fetch(`/api/friends/${params.id}/sync?from=${FROM_2026}&max=250`, {
      method: "POST",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) pushToast("err", json.error ?? "Erreur backfill");
    else pushToast("ok", `Backfill OK ✅ (${json.matchCount} matchs)`);
    await loadAll().catch(() => {});
    setBusy(false);
  }

  async function uploadAvatar(file?: File | null) {
    if (!file || !friend) return;

    setBusy(true);
    try {
      // Prefer Supabase Storage if configured
      const sb = getSupabaseClient();
      if (sb) {
        const bucket = "avatars";
        const path = `${friend.id}/${Date.now()}-${file.name}`.replace(/\s+/g, "_");

        const up = await sb.storage.from(bucket).upload(path, file, {
          upsert: true,
          contentType: file.type || "image/png",
        });

        if (up.error) throw new Error(up.error.message);

        const pub = sb.storage.from(bucket).getPublicUrl(path);
        const url = pub.data.publicUrl;

        const res = await fetch(`/api/friends/${friend.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ avatarUrl: url }),
        });
        if (!res.ok) throw new Error("Failed to update avatarUrl in DB");
        pushToast("ok", "Avatar upload (Supabase Storage) ✅");
      } else {
        const dataUrl = await fileToAvatarDataUrl(file, 128, 0.82);
        const res = await fetch(`/api/friends/${friend.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ avatarUrl: dataUrl }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Erreur avatar");
        pushToast("ok", "Avatar mis à jour ✅");
      }

      await loadAll().catch(() => {});
    } catch (e: any) {
      pushToast("err", e?.message ?? "Erreur avatar");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    const next = Math.min(200, take + 30);
    setTake(next);
    pushToast("info", `Chargement (${next})…`);
    await loadAll(next).catch((e) => pushToast("err", e.message));
  }

  return (
    <main className="container">
      <ToastHost toasts={toasts} remove={removeToast} />

      <header className="topbar">
        <div className="brand">
          <div className="avatar" aria-hidden>
            {friend?.avatarUrl ? (
              <img src={friend.avatarUrl} alt="" />
            ) : (
              <span>{initials(friend?.riotName ?? "Monkey")}</span>
            )}
          </div>
          <div>
            <h1 className="h1">{friend ? `${friend.riotName}#${friend.riotTag}` : "Monkey"}</h1>
            <p className="p">
              Solo: <b>{formatRank(friend?.rankedSoloTier ?? null, friend?.rankedSoloRank ?? null, friend?.rankedSoloLP ?? null)}</b>
              {wr != null && (
                <>
                  {" "}· WR <b>{wr}%</b> ({friend?.rankedSoloWins ?? 0}-{friend?.rankedSoloLosses ?? 0})
                </>
              )}
              <br />
              Flex: <b>{formatRank(friend?.rankedFlexTier ?? null, friend?.rankedFlexRank ?? null, friend?.rankedFlexLP ?? null)}</b>
              {wrFlex != null && (
                <>
                  {" "}· WR <b>{wrFlex}%</b> ({friend?.rankedFlexWins ?? 0}-{friend?.rankedFlexLosses ?? 0})
                </>
              )}
            </p>
          </div>
        </div>

        <div className="row">
          <a className="button" href="/">
            Dashboard
          </a>
          <button className="button" onClick={syncLatest} disabled={busy}>
            {busy ? "…" : "Sync récent"}
          </button>
          <button className="button buttonPrimary" onClick={backfill2026} disabled={busy}>
            {busy ? "…" : "Backfill 2026"}
          </button>
        </div>
      </header>

      <div className="grid cols2" style={{ marginTop: 14 }}>
        <section className="card">
          <h2 className="cardTitle">Profil</h2>

          <div className="row">
            <div className="avatar" title="Avatar">
              {friend?.avatarUrl ? (
                <img src={friend.avatarUrl} alt="Avatar" />
              ) : (
                <span>{initials(friend?.riotName ?? "Monkey")}</span>
              )}
            </div>

            <label className="button" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => uploadAvatar(e.target.files?.[0] ?? null)}
              />
              Changer avatar
            </label>

            <div className="spacer" />
            <span className="badge">{friend?.region ?? "euw1"}</span>
          </div>

          <div className="hr" />

          <h3 className="cardTitle" style={{ marginTop: 4 }}>
            Top champs (Ranked Solo)
          </h3>

          {summary === null ? (
            <div className="grid">
              <Skeleton style={{ height: 52 }} />
              <Skeleton style={{ height: 52 }} />
            </div>
          ) : summary.champs.length === 0 ? (
            <p className="small">Pas assez de ranked solo en DB (sync).</p>
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {summary.champs.map((c) => (
                <div key={c.champ} className="rowCard">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <div className="name" style={{ fontSize: 14 }}>
                        {c.champ}
                      </div>
                      <div className="sub">
                        {c.games} games · {c.wins}-{c.games - c.wins}
                      </div>
                    </div>
                    <div className="badge">
                      WR <b style={{ marginLeft: 6 }}>{c.winrate}%</b>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="small" style={{ marginTop: 10 }}>
            (Optionnel) Avatars Supabase Storage : <code>NEXT_PUBLIC_SUPABASE_URL</code> +{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> + bucket <code>avatars</code>.
          </p>
        </section>

        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="cardTitle" style={{ marginBottom: 0 }}>
              Games depuis {FROM_2026}
            </h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge">Affichées: {matches?.length ?? 0}</span>
              <button className="button" onClick={loadMore} disabled={busy || take >= 200}>
                Charger +
              </button>
            </div>
          </div>

          {matches === null ? (
            <div className="grid">
              <Skeleton style={{ height: 120 }} />
              <Skeleton style={{ height: 120 }} />
              <Skeleton style={{ height: 120 }} />
            </div>
          ) : matches.length === 0 ? (
            <p className="small">
              Aucune game chargée en DB pour {FROM_2026}+ — clique “Backfill 2026”.
            </p>
          ) : (
            <div className="grid">
              {groupedByDay.map((g) => (
                <div key={g.key} className="grid" style={{ gap: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <div className="name" style={{ fontSize: 14 }}>{g.label}</div>
                    <div className="sub">{g.items.length} game{g.items.length > 1 ? "s" : ""}</div>
                  </div>

                  {g.items.map((m) => {
                    const opened = !!open[m.matchId];
                    const incomplete = (m.participantCount ?? 10) < 10;

                    return (
                      <div key={m.matchId} className="matchCard">
                    {/* Summary */}
                    <button
                      className="matchHeader"
                      onClick={() => toggle(m.matchId)}
                      aria-expanded={opened}
                      title="Cliquer pour ouvrir / fermer"
                    >
                      <div className="matchTop">
                        <div className={`pill ${m.win ? "win" : "lose"}`}>
                          {m.win ? "VICTOIRE" : "DÉFAITE"}
                        </div>
                        <div className="pill">{queueLabel(m.queueId)}</div>
                        <div className="pill">{m.champ ?? "—"}</div>
                        <div className="pill">{fmtDur(m.gameDurationS)}</div>
                        <div className="pill">KDA {kdaStr(m.k, m.d, m.a)}</div>
                        {m.dmg != null && <div className="pill">DMG {m.dmg}</div>}
                        {m.gold != null && <div className="pill">Gold {m.gold}</div>}
                        <div className="spacer" />
                        <div className="pill">Team K {m.team.allyKills}-{m.team.enemyKills}</div>
                        <div className="pill">Gold {m.team.allyGold}-{m.team.enemyGold}</div>
                        <div className="pill">DMG {m.team.allyDmg}-{m.team.enemyDmg}</div>
                        {incomplete && <div className="pill warn">⚠ participants</div>}
                        <div className="pill">{opened ? "▲" : "▼"}</div>
                      </div>

                      <div className="matchMeta">
                        <span className="sub">{fmtWhen(m.gameStartMs)}</span>
                        <span className="sub">
                          {m.cs != null ? <> · CS <b>{m.cs}</b></> : null}
                          {m.vision != null ? <> · Vision <b>{m.vision}</b></> : null}
                        </span>
                      </div>
                    </button>

                    {/* Details (collapsed) */}
                    {opened ? (
                      <div className="matchBody">
                        <div className="grid cols2">
                          <div>
                            <div className="sub" style={{ marginBottom: 8 }}>
                              <b>Alliés</b>
                            </div>
                            <div className="grid" style={{ gap: 8 }}>
                              {m.allies.map((p) => (
                                <div key={p.puuid} className="rowCard">
                                  <div className="row" style={{ justifyContent: "space-between" }}>
                                    <div className="min0" style={{ minWidth: 220 }}>
                                      <div className="name" style={{ fontSize: 13 }}>
                                        {p.name}
                                      </div>
                                      <div className="sub">
                                        {p.champ ?? "—"} · {p.lane ?? "—"} · {p.role ?? "—"}
                                      </div>
                                    </div>
                                    <div className="row" style={{ justifyContent: "flex-end" }}>
                                      <span className="pill">
                                        KDA <b style={{ marginLeft: 6 }}>{kdaStr(p.k, p.d, p.a)}</b>
                                      </span>
                                      {p.dmg != null && (
                                        <span className="pill">
                                          DMG <b style={{ marginLeft: 6 }}>{p.dmg}</b>
                                        </span>
                                      )}
                                      {p.gold != null && (
                                        <span className="pill">
                                          Gold <b style={{ marginLeft: 6 }}>{p.gold}</b>
                                        </span>
                                      )}
                                      <span className="pill">
                                        CS <b style={{ marginLeft: 6 }}>{p.cs}</b>
                                      </span>
                                      {p.vision != null && (
                                        <span className="pill">
                                          V <b style={{ marginLeft: 6 }}>{p.vision}</b>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="sub" style={{ marginBottom: 8 }}>
                              <b>Ennemis</b>
                            </div>
                            <div className="grid" style={{ gap: 8 }}>
                              {m.enemies.map((p) => (
                                <div key={p.puuid} className="rowCard">
                                  <div className="row" style={{ justifyContent: "space-between" }}>
                                    <div className="min0" style={{ minWidth: 220 }}>
                                      <div className="name" style={{ fontSize: 13 }}>
                                        {p.name}
                                      </div>
                                      <div className="sub">
                                        {p.champ ?? "—"} · {p.lane ?? "—"} · {p.role ?? "—"}
                                      </div>
                                    </div>
                                    <div className="row" style={{ justifyContent: "flex-end" }}>
                                      <span className="pill">
                                        KDA <b style={{ marginLeft: 6 }}>{kdaStr(p.k, p.d, p.a)}</b>
                                      </span>
                                      {p.dmg != null && (
                                        <span className="pill">
                                          DMG <b style={{ marginLeft: 6 }}>{p.dmg}</b>
                                        </span>
                                      )}
                                      {p.gold != null && (
                                        <span className="pill">
                                          Gold <b style={{ marginLeft: 6 }}>{p.gold}</b>
                                        </span>
                                      )}
                                      <span className="pill">
                                        CS <b style={{ marginLeft: 6 }}>{p.cs}</b>
                                      </span>
                                      {p.vision != null && (
                                        <span className="pill">
                                          V <b style={{ marginLeft: 6 }}>{p.vision}</b>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
                          <a className="button" href={`/match/${m.matchId}`}>
                            Voir match
                          </a>
                        </div>
                      </div>
                    ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          <p className="small" style={{ marginTop: 10 }}>
            Si tu vois “⚠ participants”, relance “Sync récent” (ou “Backfill 2026”) : le serveur reconstruit les
            participants depuis le raw JSON (sans re-call Riot quand possible).
          </p>
        </section>
      </div>
    </main>
  );
}
