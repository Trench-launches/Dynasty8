import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { prisma } from "@/server/db";
import { verifyAndRecordReceipt } from "@/server/demolition/receipts";
import { handle, json, readJsonBody } from "@/server/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({ signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/) }).strict();

export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json({ items: await prisma.feeReceipt.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { allocation: true } }) });
});

/**
 * POST (ADMIN): manual funding workflow. An admin submits the signature of a Pump
 * distribute transaction; it is verified on-chain exactly like an auto-scanned one.
 * Nothing is booked on an admin's word alone.
 */
export const POST = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await verifyAndRecordReceipt(body.parse(await readJsonBody(req)).signature, "MANUAL", actor));
});
