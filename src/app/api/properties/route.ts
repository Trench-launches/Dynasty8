import { listPropertiesQuery, LIST_PROPERTIES_PARAMS } from "@/server/api/schemas";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";
import { listProperties } from "@/server/services/properties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/properties: paginated, filtered, sorted listing of published properties. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  const query = listPropertiesQuery.parse(queryObject(req, LIST_PROPERTIES_PARAMS));
  return json(await listProperties(query), { cacheSeconds: 15 });
});
