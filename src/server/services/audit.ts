import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export interface Actor {
  id: string | null;
  label: string;
  ip?: string;
}

export const SYSTEM_ACTOR: Actor = { id: null, label: "system:market-sync" };

type Tx = Prisma.TransactionClient | typeof prisma;

/** Append-only record of every admin and system change. */
export async function recordAudit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: "Property" | "Token" | "AdminUser" | "Fund" | "Buyback",
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      actorLabel: actor.label,
      action,
      entityType,
      entityId,
      before: toJson(before),
      after: toJson(after),
      ip: actor.ip,
    },
  });
}

/** JSON snapshot; bigint amounts are stored as decimal strings (exact). */
function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue;
}
