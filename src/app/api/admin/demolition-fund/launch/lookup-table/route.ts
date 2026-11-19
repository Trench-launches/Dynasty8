import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prepareLookupTable } from "@/server/demolition/launch";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const body = z.object({ authority: publicKeySchema }).strict();

/** POST (ADMIN) {authority}: unsigned tx creating the project's launch lookup table, for the launch wallet to sign. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const { authority } = body.parse(await readJsonBody(req));
  return json(await prepareLookupTable(authority, actor));
});
