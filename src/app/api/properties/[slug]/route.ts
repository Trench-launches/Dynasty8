import { slugSchema } from "@/server/api/schemas";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";
import { getProperty } from "@/server/services/properties";

/** GET /api/properties/:slug */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  const slug = slugSchema.parse((await ctx.params).slug);
  return json(await getProperty(slug), { cacheSeconds: 15 });
});
