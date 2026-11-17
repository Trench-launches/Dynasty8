import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";
import { getEcosystemMarkets } from "@/server/services/ecosystem";

/** GET /api/ecosystem/markets: live property tokens with their market snapshots. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  return json({ items: await getEcosystemMarkets() }, { cacheSeconds: 15 });
});
