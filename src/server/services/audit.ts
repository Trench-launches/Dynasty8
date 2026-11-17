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
  entityType: "Property" | "Token" | "AdminUser",
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
      before: before === undefined || before === null ? undefined : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
      after: after === undefined || after === null ? undefined : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
      ip: actor.ip,
    },
  });
}
