import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prepareSplitDevBuy } from "@/server/demolition/launch";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const body = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/), creator: publicKeySchema }).strict();

/** POST (ADMIN): the 0.01 SOL dev buy as its own transaction; refused until fee sharing is locked on-chain. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await prepareSplitDevBuy(body.parse(await readJsonBody(req)), actor));
});
