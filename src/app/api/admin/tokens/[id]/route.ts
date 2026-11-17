import { z } from "zod";
import { updateTokenBody } from "@/server/api/schemas";
import { requireAdmin } from "@/server/auth/admin";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { setTokenStatus } from "@/server/services/admin-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);

/** PATCH /api/admin/tokens/:id (ADMIN): deactivate a compromised token or re-activate a verified one. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const id = idSchema.parse((await ctx.params).id);
  const body = updateTokenBody.parse(await readJsonBody(req));
  return json(await setTokenStatus(id, body.deploymentStatus, body.reason, actor));
});
