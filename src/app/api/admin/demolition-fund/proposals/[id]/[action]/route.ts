import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { buildMemberTransaction } from "@/server/demolition/proposals";
import { ApiError, handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const idSchema = z.string().regex(/^[a-z0-9]{20,40}$/);
const body = z.object({ member: publicKeySchema }).strict();

type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * POST /api/admin/demolition-fund/proposals/:id/:action (ADMIN), action = approve | reject | execute
 * Body {member}: the connected multisig member's wallet. Returns an UNSIGNED transaction for that
 * member to sign in their own wallet. Nothing is signed or sent here; the Squads program enforces
 * the threshold, and execute is refused until the proposal is approved on-chain.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const p = await ctx.params;
  const id = idSchema.parse(p.id);
  if (p.action !== "approve" && p.action !== "reject" && p.action !== "execute") throw new ApiError(404, "NOT_FOUND", "Unknown action");
  const { member } = body.parse(await readJsonBody(req));
  return json(await buildMemberTransaction(id, p.action, member, actor));
});
