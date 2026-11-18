import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { fundMultisigStatus } from "@/server/demolition/proposals";
import { handle, json, queryObject } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const q = z.object({ member: publicKeySchema.optional() });

/** GET (VIEWER): registered treasury wallets and the live fund multisig (threshold, members, permissions). Read-only. */
export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  const { member } = q.parse(queryObject(req, ["member"]));
  return json(await fundMultisigStatus(member));
});
