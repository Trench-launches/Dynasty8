import { auditQuery } from "@/server/api/schemas";
import { requireAdmin } from "@/server/auth/admin";
import { prisma } from "@/server/db";
import { handle, json, queryObject } from "@/server/http/responses";

/** GET /api/admin/audit (VIEWER): review recent changes. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  const q = auditQuery.parse(queryObject(req, ["limit", "entityType", "entityId"]));
  const items = await prisma.auditLog.findMany({
    where: { entityType: q.entityType, entityId: q.entityId },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  return json({ items });
});
