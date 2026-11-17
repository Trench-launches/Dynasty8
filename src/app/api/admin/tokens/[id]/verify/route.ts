import { z } from "zod";
import { verifyTokenBody } from "@/server/api/schemas";
import { requireAdmin } from "@/server/auth/admin";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { verifyToken } from "@/server/services/admin-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);

/** POST /api/admin/tokens/:id/verify (ADMIN): mark a reviewed PENDING_VERIFICATION token LIVE. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const id = idSchema.parse((await ctx.params).id);
  const body = verifyTokenBody.parse(await readJsonBody(req));
  return json(await verifyToken(id, body, actor));
});
