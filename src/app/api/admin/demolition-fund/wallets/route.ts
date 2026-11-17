import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prisma } from "@/server/db";
import { setWallet } from "@/server/demolition/fund";
import { handle, json, readJsonBody } from "@/server/http/responses";
import { publicKeySchema } from "@/server/solana/address";

const body = z
  .object({
    role: z.enum(["FUND", "ECOSYSTEM", "OPERATIONS"]),
    address: publicKeySchema,
    label: z.string().trim().min(1).max(80),
    isMultisig: z.boolean(),
  })
  .strict();

export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({ items: await prisma.treasuryWallet.findMany() });
});

/** PUT (ADMIN): register a treasury wallet address. Never accepts keys. */
export const PUT = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const b = body.parse(await readJsonBody(req));
  return json(await setWallet(b.role, b.address, b.label, b.isMultisig, actor));
});
