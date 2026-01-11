import { getPrisma } from "@/lib/prisma";

/**
 * DB-backed lock to avoid running multiple syncs at the same time.
 * Works even behind poolers (no session-level advisory locks required).
 */
export async function withGlobalSyncLock<T>(fn: () => Promise<T>, ttlMs = 10 * 60_000): Promise<T> {
  const prisma = getPrisma();
  const now = new Date();

  // Ensure row exists
  await prisma.syncLock.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, lockedUntil: new Date(0) },
  });

  const lockedUntil = new Date(now.getTime() + ttlMs);

  const acquired = await prisma.syncLock.updateMany({
    where: {
      id: 1,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockedUntil },
  });

  if (acquired.count !== 1) {
    throw new Error("Sync already running. Réessaie dans quelques secondes.");
  }

  try {
    return await fn();
  } finally {
    // Release lock early
    await prisma.syncLock.update({
      where: { id: 1 },
      data: { lockedUntil: now },
    }).catch(() => {});
  }
}
