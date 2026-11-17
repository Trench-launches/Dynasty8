import { attachMintBody, slugSchema } from "@/server/api/schemas";
import { requireAdmin } from "@/server/auth/admin";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { attachMintToProperty } from "@/server/services/admin-tokens";

/**
 * POST /api/admin/properties/:slug/token (ADMIN): register an already-deployed mint.
 * Verifies the mint on-chain; result is PENDING_VERIFICATION until /verify is called.
 * Does not deploy, sign or transfer anything.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const slug = slugSchema.parse((await ctx.params).slug);
  const body = attachMintBody.parse(await readJsonBody(req));
  return json(await attachMintToProperty(slug, body.mintAddress, body.creatorWallet, actor));
});
