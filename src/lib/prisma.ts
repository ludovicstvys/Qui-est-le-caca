import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Lazy Prisma client getter.
 * Avoids instantiating Prisma at module import time (helps during `next build`).
 */
export function getPrisma() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const prisma = new PrismaClient({ log: ["error", "warn"] });

  // Cache in dev to avoid exhausting connections on hot reload
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

  return prisma;
}
