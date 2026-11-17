import { getFundTransaction } from "@/server/demolition/dashboard";
import { assertSignature } from "@/server/demolition/receipts";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/demolition-fund/transactions/:signature */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ signature: string }> }) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  const signature = assertSignature((await ctx.params).signature);
  return json(await getFundTransaction(signature), { cacheSeconds: 30 });
});
