import { getPropertyContributions } from "@/server/demolition/dashboard";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";

/** GET /api/demolition-fund/properties: properties ranked by verified revenue contributed. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  return json({ items: await getPropertyContributions() }, { cacheSeconds: 30 });
});
