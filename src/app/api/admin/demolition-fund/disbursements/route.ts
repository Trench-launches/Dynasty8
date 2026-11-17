import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prisma } from "@/server/db";
import { recordDisbursement } from "@/server/demolition/reconcile";
import { handle, json, readJsonBody } from "@/server/http/responses";

const body = z
  .object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/), role: z.enum(["ECOSYSTEM", "OPERATIONS"]) })
  .strict();

export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({ items: await prisma.disbursement.findMany({ orderBy: { verifiedAt: "desc" } }) });
});

/** POST (ADMIN): record a multisig transfer to the ecosystem/operations wallet, verified on-chain. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  const b = body.parse(await readJsonBody(req));
  return json(await recordDisbursement(b.signature, b.role, actor));
});
