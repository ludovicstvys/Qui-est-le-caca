# Monkeys dashboard (Next.js + Prisma + PostgreSQL + Riot API)

Dashboard pour **suivre les games LoL de tes potes** :
- **Rank actuel + LP** (Ranked Solo/Flex)
- **Winrate de la saison** (Ranked Solo)
- Matchs complets : **alliés + ennemis**, KDA, **dégâts**, **gold**, CS, vision, etc.
- **Page Match** + **Page Synergie**
- Anti-quota Riot : **délai min + retry 429** + sync séquentiel
- **Sync auto** via Vercel Cron (`vercel.json`)

---

## Déploiement “sans npm sur ton PC”
Tu n’as pas besoin d’installer npm localement :
- Tu push le repo sur GitHub
- Tu importes sur **Vercel**
- Vercel installe/compile tout automatiquement

---

## Variables d’environnement (Vercel → Settings → Environment Variables)

```env
RIOT_API_KEY="RGAPI-xxxx"
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require&schema=public&pgbouncer=true"
RIOT_REGION="euw1"
RIOT_ROUTING="europe"
MATCH_FRESHNESS_MINUTES="30"
RIOT_MIN_DELAY_MS="140"
```

### Note Supabase / erreur “prepared statement already exists”
Si tu utilises le **pooler Supabase** (PgBouncer), ajoute **`pgbouncer=true`** dans `DATABASE_URL`.
Si tu es sur le host direct `db.xxx.supabase.co`, ça peut aussi aider dans certains setups.

---

## Migration SQL (à exécuter dans Supabase → SQL Editor)

> Important : Prisma ne peut pas “migrer” ta DB depuis Vercel sans CLI.
> Ici, tu fais la migration via SQL (copier/coller).

```sql
-- --- Friend: champs sync + rank ---
alter table "Friend" add column if not exists "lastMatchId" text;
alter table "Friend" add column if not exists "lastSyncAt" timestamptz;

alter table "Friend" add column if not exists "summonerId" text;

alter table "Friend" add column if not exists "rankedSoloTier" text;
alter table "Friend" add column if not exists "rankedSoloRank" text;
alter table "Friend" add column if not exists "rankedSoloLP" int4;
alter table "Friend" add column if not exists "rankedSoloWins" int4;
alter table "Friend" add column if not exists "rankedSoloLosses" int4;

alter table "Friend" add column if not exists "rankedFlexTier" text;
alter table "Friend" add column if not exists "rankedFlexRank" text;
alter table "Friend" add column if not exists "rankedFlexLP" int4;
alter table "Friend" add column if not exists "rankedFlexWins" int4;
alter table "Friend" add column if not exists "rankedFlexLosses" int4;

alter table "Friend" add column if not exists "rankFetchedAt" timestamptz;
alter table "Friend" add column if not exists "avatarUrl" text;

-- --- Match: ajout participants (table) + index ---
create table if not exists "MatchParticipant" (
  "matchId" text not null,
  "puuid" text not null,

  "teamId" int4 null,
  "win" boolean null,

  "summonerName" text null,
  "riotIdGameName" text null,
  "riotIdTagline" text null,

  "championName" text null,
  "lane" text null,
  "role" text null,

  "kills" int4 null,
  "deaths" int4 null,
  "assists" int4 null,

  "goldEarned" int4 null,
  "totalDamageDealtToChampions" int4 null,
  "visionScore" int4 null,
  "totalMinionsKilled" int4 null,
  "neutralMinionsKilled" int4 null,

  constraint "MatchParticipant_pkey" primary key ("matchId","puuid"),
  constraint "MatchParticipant_matchId_fkey"
    foreign key ("matchId") references "Match"("id") on delete cascade
);

create index if not exists "MatchParticipant_puuid_idx" on "MatchParticipant" ("puuid");
create index if not exists "MatchParticipant_match_team_idx" on "MatchParticipant" ("matchId","teamId");

-- --- Rank snapshots (historique) ---
create table if not exists "RankSnapshot" (
  "id" text primary key,
  "friendId" text not null,
  "queueType" text not null,
  "tier" text null,
  "rank" text null,
  "lp" int4 null,
  "wins" int4 null,
  "losses" int4 null,
  "createdAt" timestamptz not null default now(),

  constraint "RankSnapshot_friendId_fkey"
    foreign key ("friendId") references "Friend"("id") on delete cascade
);

create index if not exists "RankSnapshot_friend_created_idx" on "RankSnapshot" ("friendId","createdAt");

-- --- Sync lock (éviter double sync) ---
create table if not exists "SyncLock" (
  "id" int4 primary key,
  "lockedUntil" timestamptz null,
  "updatedAt" timestamptz not null default now()
);

-- --- Indices utiles ---
create index if not exists "FriendMatch_friend_added_idx" on "FriendMatch" ("friendId","addedAt");
create index if not exists "Match_fetchedAt_idx" on "Match" ("fetchedAt");
```

Ensuite : redeploy Vercel → clique **Sync tout**.

---

## Sync auto (Cron)
Le repo contient `vercel.json` :

- toutes les **30 minutes**, Vercel appelle : `/api/cron/sync`

Tu peux ajuster la fréquence dans `vercel.json`.

---

## Avatars dans Supabase Storage (optionnel)
Par défaut : avatar stocké en DB (DataURL compressée).

Si tu veux **des vrais fichiers** :
1. Crée un bucket public `avatars` dans Supabase Storage
2. Ajoute :
```env
NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="xxxxx"
```
3. Sur la page d’un monkey : “Changer avatar” upload direct dans Storage.

---

## Pages
- `/` : overview (rank/LP/WR + last game + sync global)
- `/friend/:id` : stats d’un monkey + teams allies/ennemis + dégâts/gold
- `/match/:matchId` : détail du match
- `/synergy` : duo winrate quand 2 monkeys jouent ensemble
