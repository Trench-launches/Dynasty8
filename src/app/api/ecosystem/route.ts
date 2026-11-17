import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";
import { getEcosystem } from "@/server/services/ecosystem";

/** GET /api/ecosystem: native token + ecosystem totals. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  return json(await getEcosystem(), { cacheSeconds: 15 });
});
