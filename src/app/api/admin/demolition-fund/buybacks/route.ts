import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prisma } from "@/server/db";
import { createBuybackRequest } from "@/server/demolition/buyback";
import { handle, json, readJsonBody } from "@/server/http/responses";

const body = z
  .object({
    /** Client-generated key; replaying the same key returns the same request. */
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    budgetLamports: z
      .string()
      .regex(/^\d{1,19}$/)
      .transform((v) => BigInt(v))
      .optional(),
  })
  .strict();

export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({
    items: await prisma.buybackRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { approvals: true, transactions: true } }),
  });
});

/** POST (ADMIN): plan a buyback from verified, unreserved revenue, within all caps. */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await createBuybackRequest(body.parse(await readJsonBody(req)), actor), { status: 201 });
});
