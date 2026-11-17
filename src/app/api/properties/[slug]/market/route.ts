import { slugSchema } from "@/server/api/schemas";
import { getConfig } from "@/server/config";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";
import { toMarketDto, toTokenDto } from "@/server/services/mappers";
import { getPublishedPropertyRow } from "@/server/services/properties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/properties/:slug/market: latest stored snapshot with freshness. Never calls providers. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  queryObject(req, []);
  const slug = slugSchema.parse((await ctx.params).slug);
  const row = await getPublishedPropertyRow(slug);
  return json(
    {
      slug: row.slug,
      token: row.token ? toTokenDto(row.token) : null,
      market: toMarketDto(row.token, Date.now(), getConfig().MARKET_STALE_AFTER_MS),
    },
    { cacheSeconds: 10 },
  );
});
