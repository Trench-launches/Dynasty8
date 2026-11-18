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
    /** Required when isMultisig: the Squads v4 multisig account whose vault is `address`. */
    multisigAddress: publicKeySchema.optional(),
    vaultIndex: z.number().int().min(0).max(255).optional(),
  })
  .strict();

export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({ items: await prisma.treasuryWallet.findMany() });
});

/** PUT (ADMIN): register a treasury wallet. Multisig vaults are verified on-chain. Never accepts keys. */
export const PUT = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const b = body.parse(await readJsonBody(req));
  return json(
    await setWallet(b.role, { address: b.address, label: b.label, isMultisig: b.isMultisig, multisigAddress: b.multisigAddress, vaultIndex: b.vaultIndex }, actor),
  );
});
