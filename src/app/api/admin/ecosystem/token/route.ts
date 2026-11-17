import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";
import { attachNativeMint } from "@/server/services/admin-tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({ mintAddress: publicKeySchema }).strict();

/** POST /api/admin/ecosystem/token (ADMIN): attach the verified REALTY mint. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const { mintAddress } = body.parse(await readJsonBody(req));
  return json(await attachNativeMint(mintAddress, actor));
});
