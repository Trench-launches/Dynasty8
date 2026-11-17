import { getFundSummary } from "@/server/demolition/dashboard";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";

/** GET /api/demolition-fund/summary: verified totals for the Demolition Fund. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  return json(await getFundSummary(), { cacheSeconds: 15 });
});
