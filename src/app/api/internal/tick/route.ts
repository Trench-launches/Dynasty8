import { timingSafeEqual } from "node:crypto";
import { fundPass, marketSyncPass } from "@/server/jobs";
import { ApiError, handle, json } from "@/server/http/responses";

/**
 * POST /api/internal/tick: one pass of each background job. Called once a minute by the
 * Cloudflare scheduled handler (custom-worker.ts) with `Authorization: Bearer <CRON_SECRET>`.
 * Disabled (404) when CRON_SECRET is not set, so it is never open to the public.
 */
export const POST = handle(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new ApiError(404, "NOT_FOUND", "Not found");
  if (!sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    throw new ApiError(401, "UNAUTHORIZED", "Unauthorized");
  }

  // Prune old snapshots once an hour (the tick runs every minute).
  const prune = new Date().getUTCMinutes() === 0;
  const [market, fund] = await Promise.all([marketSyncPass({ prune }), fundPass()]);
  return json({ market, fund });
});

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
