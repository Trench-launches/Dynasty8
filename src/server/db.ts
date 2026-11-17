import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Single Prisma client per process (survives Next.js dev hot reloads). */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === "test" ? [] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
