import { getPrisma } from "@/lib/prisma";

/**
 * DB-backed lock to avoid running multiple syncs at the same time.
 * Works in serverless + poolers (doesn't rely on session-level advisory locks).
 *
 * If the SyncLock table doesn't exist yet, we auto-create it (self-healing).
 */
export async function withGlobalSyncLock<T>(fn: () => Promise<T>, ttlMs = 10 * 60_000): Promise<T> {
  const prisma = getPrisma();
  const now = new Date();

  async function ensureTable() {
    // Important: quoted identifier to match Prisma model/table name (capitalization).
    await prisma.$executeRawUnsafe(`
      create table if not exists "SyncLock" (
        "id" int4 primary key,
        "lockedUntil" timestamptz null,
        "updatedAt" timestamptz not null default now()
      );
    `);
  }

  try {
    // Ensure row exists
    await prisma.syncLock.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, lockedUntil: new Date(0) },
    });
  } catch (e: any) {
    // P2021: table does not exist
    if (e?.code === "P2021" || String(e?.message || "").includes("SyncLock")) {
      await ensureTable();
      await prisma.syncLock.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, lockedUntil: new Date(0) },
      });
    } else {
      throw e;
    }
  }

  const lockedUntil = new Date(now.getTime() + ttlMs);

  const acquired = await prisma.syncLock.updateMany({
    where: {
      id: 1,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil },
  });

  if (acquired.count !== 1) {
    throw new Error("Sync déjà en cours. Réessaie dans quelques secondes.");
  }

  try {
    return await fn();
  } finally {
    // Release lock early
    await prisma.syncLock
      .update({
        where: { id: 1 },
        data: { lockedUntil: now },
      })
      .catch(() => {});
  }
}
