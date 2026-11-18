import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prepareAtomicLaunch } from "@/server/demolition/launch";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const body = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
    creator: publicKeySchema,
    /** Public key of a mint keypair generated in the owner's browser. Its secret is never sent. */
    mint: publicKeySchema,
    uri: z.string().url().max(200),
    lookupTable: publicKeySchema,
  })
  .strict();

/**
 * POST (ADMIN): unsigned, simulated atomic launch (create_v2 + fee-sharing config + locked
 * 60/25/15 treasury shares). Name, symbol and shareholders come from the committed config and the
 * registered treasury. Nothing is signed or sent here.
 */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await prepareAtomicLaunch(body.parse(await readJsonBody(req)), actor));
});
