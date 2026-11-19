import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prepareSplitCreate } from "@/server/demolition/launch";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const body = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
    creator: publicKeySchema,
    mint: publicKeySchema,
    uri: z.string().url().max(200),
    /** Must be true: the owner accepts that fees from trades before step 2 do not reach the treasury. */
    acknowledgeGapRisk: z.literal(true),
  })
  .strict();

/**
 * POST (ADMIN): FALLBACK step 1, create_v2 only, unsigned and simulated. Same gates as the atomic
 * launch. Use only when the atomic launch cannot be used; see FALLBACK_GAP_RISK.
 */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await prepareSplitCreate(body.parse(await readJsonBody(req)), actor));
});
