import { z } from "zod";
import { getFundBurns } from "@/server/demolition/dashboard";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

/** GET /api/demolition-fund/burns: verified REALTY burns. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  const { limit } = q.parse(queryObject(req, ["limit"]));
  return json({ items: await getFundBurns(limit) }, { cacheSeconds: 15 });
});
