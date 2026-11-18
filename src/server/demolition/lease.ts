import "server-only";
import { prisma } from "@/server/db";

/**
 * Single-runner lease for the fund worker. An atomic conditional UPDATE on the FundConfig
 * row grants the lease only if it is free or expired, so it works through a connection pool
 * (unlike a session-level advisory lock, which can be taken on one pooled connection and
 * released on another). The holder renews it each pass; a crashed holder's lease expires.
 */
export async function acquireLease(owner: string, ttlMs: number, now = new Date()): Promise<boolean> {
  await prisma.fundConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const until = new Date(now.getTime() + ttlMs);
  const n = await prisma.$executeRaw`
    UPDATE "FundConfig" SET "workerLeaseOwner" = ${owner}, "workerLeaseUntil" = ${until}
    WHERE "id" = 1 AND ("workerLeaseOwner" IS NULL OR "workerLeaseOwner" = ${owner} OR "workerLeaseUntil" < ${now})`;
  return n === 1;
}

export async function releaseLease(owner: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "FundConfig" SET "workerLeaseOwner" = NULL, "workerLeaseUntil" = NULL WHERE "id" = 1 AND "workerLeaseOwner" = ${owner}`;
}
