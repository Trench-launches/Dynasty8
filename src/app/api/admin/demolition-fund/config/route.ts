import { z } from "zod";
import { requireAdmin } from "@/server/auth/admin";
import { getFundConfig, updateFundConfig } from "@/server/demolition/fund";
import { handle, json, readJsonBody } from "@/server/http/responses";

const lamports = z
  .string()
  .regex(/^\d{1,19}$/)
  .transform((v) => BigInt(v));

const patch = z
  .object({
    buybackBps: z.number().int().min(0).max(10_000),
    ecosystemBps: z.number().int().min(0).max(10_000),
    operationsBps: z.number().int().min(0).max(10_000),
    maxBuybackLamportsPerTx: lamports,
    maxDailyBuybackLamports: lamports,
    reserveLamports: lamports,
    minBuybackLamports: lamports,
    minLiquidityUsd: z.number().int().min(0),
    maxPriceImpactBps: z.number().int().min(1).max(2_000),
    slippageBps: z.number().int().min(1).max(1_000),
    cooldownSeconds: z.number().int().min(60),
    requiredApprovals: z.number().int().min(1).max(5),
    maxConsecutiveFailures: z.number().int().min(1).max(20),
  })
  .partial()
  .strict();

export const GET = handle(async (req: Request) => {
  await requireAdmin(req, "VIEWER");
  return json(await getFundConfig());
});

/** PATCH (ADMIN): allocation percentages and safety limits. Unattended execution cannot be enabled here. */
export const PATCH = handle(async (req: Request) => {
  const { actor } = await requireAdmin(req, "ADMIN");
  return json(await updateFundConfig(patch.parse(await readJsonBody(req)), actor));
});
