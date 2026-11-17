import { z } from "zod";
import { getFundHistory } from "@/server/demolition/dashboard";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json, queryObject } from "@/server/http/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), before: z.string().datetime().optional() });

/** GET /api/demolition-fund/history?limit&before: receipts, buybacks, burns and disbursements, newest first. */
export const GET = handle(async (req: Request) => {
  enforceRateLimit(publicApiLimiter, req, "public");
  const { limit, before } = q.parse(queryObject(req, ["limit", "before"]));
  return json(await getFundHistory(limit, before ? new Date(before) : null), { cacheSeconds: 15 });
});
