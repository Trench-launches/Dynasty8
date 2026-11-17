import { chartQuery, slugSchema } from "@/server/api/schemas";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";
import { getPropertyChart } from "@/server/services/charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/properties/:slug/chart?range=1h|24h|7d|30d|all */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  const { range } = chartQuery.parse(queryObject(req, ["range"]));
  const slug = slugSchema.parse((await ctx.params).slug);
  return json(await getPropertyChart(slug, range), { cacheSeconds: 30 });
});
