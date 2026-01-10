# LoL Friends (Next.js + Prisma + SQL + Riot API)

Petit dashboard pour afficher/stocker les matchs League of Legends de tes potes.

## 1) Setup

### Prérequis
- Node.js 18+
- Une clé Riot Developer: `RIOT_API_KEY`
- Une DB SQL:
  - PostgreSQL (recommandé) **ou**
  - SQLite (simple en local)

### Installer
```bash
npm install
```

Copie `.env.example` vers `.env` et remplis les valeurs :
```bash
cp .env.example .env
```

## 2) Prisma / DB

### PostgreSQL
Dans `prisma/schema.prisma`, laisse:
```prisma
provider = "postgresql"
```

Puis:
```bash
npx prisma migrate dev --name init
npx prisma generate
```

### SQLite
Dans `prisma/schema.prisma`, remplace:
```prisma
provider = "sqlite"
```

Et dans `.env`:
```env
DATABASE_URL="file:./dev.db"
```

Puis:
```bash
npx prisma migrate dev --name init
npx prisma generate
```

## 3) Lancer le site
```bash
npm run dev
```

Ouvre: http://localhost:3000

## 4) Utilisation
1. Ajoute un pote via la home (`gameName` + `tagLine`)
2. Clique **Sync 10 matchs** pour récupérer/stocker les matchs en base
3. Clique **Voir** pour afficher les matchs stockés

## 5) Déploiement (gratuit)
- **Vercel** pour Next.js (frontend + API routes)
- **Supabase** pour Postgres gratuit

⚠️ Important:
- **Ne mets pas** `RIOT_API_KEY` côté client: uniquement en variables d’environnement serveur.
- Prisma n’est pas compatible Edge: les routes API utilisent `export const runtime = "nodejs"`.

## 6) Notes / améliorations possibles
- Normaliser un "summary" (KDA, champ, win/lose) au lieu de stocker `rawJson`
- Ajouter Redis pour cache + limiter les appels Riot
- Ajouter un cron (sync automatique)


## Mise à jour DB (sans npm / sans Prisma migrate)
Si tu gères ta DB uniquement via Supabase, tu peux appliquer les changements via **SQL Editor**.

### Ajouter la colonne avatar
```sql
alter table "Friend" add column if not exists "avatarUrl" text;
```
