import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prepareFeeSharingSetup } from "@/server/demolition/fee-sharing-setup";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const body = z.object({ mint: publicKeySchema, creator: publicKeySchema }).strict();

/**
 * POST /api/admin/demolition-fund/fee-sharing/setup (ADMIN), body {mint, creator}.
 * Returns an UNSIGNED, simulated transaction for the coin's creator wallet that points the coin's
 * Pump creator fees at the registered treasury vaults (60/25/15) and locks the split. The
 * shareholders always come from the registered wallets, never from the request.
 */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const { mint, creator } = body.parse(await readJsonBody(req));
  return json(await prepareFeeSharingSetup(mint, creator, actor));
});
