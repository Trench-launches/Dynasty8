import type { HealthDto } from "@/contracts/api";
import { getConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { publicApiLimiter } from "@/server/http/rate-limit";
import { enforceRateLimit, handle, json } from "@/server/http/responses";
import { providerStatus } from "@/server/providers/registry";

/** GET /api/health: liveness + dependency summary. Reveals no versions, hosts or secrets. */
export const GET = handle(async (req: Request) => {
  // Rate limited like the other public endpoints (each call queries the database). Reading the
  // request also keeps the build from prerendering this route, so it never touches the database.
  enforceRateLimit(publicApiLimiter, req, "public");
  let database: HealthDto["database"] = "ok";
  let lastSnapshotAt: Date | null = null;
  let liveTokens = 0;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [last, live] = await Promise.all([
      prisma.marketSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } }),
      prisma.token.count({ where: { deploymentStatus: "LIVE" } }),
    ]);
    lastSnapshotAt = last?.fetchedAt ?? null;
    liveTokens = live;
  } catch {
    database = "error";
  }
  const staleAfter = getConfig().MARKET_STALE_AFTER_MS;
  const stale = liveTokens > 0 && (!lastSnapshotAt || Date.now() - lastSnapshotAt.getTime() > staleAfter);
  const body: HealthDto = {
    status: database === "ok" && !stale ? "ok" : "degraded",
    time: new Date().toISOString(),
    database,
    providers: providerStatus(),
    marketData: { lastSnapshotAt: lastSnapshotAt?.toISOString() ?? null, stale },
  };
  return json(body, { status: database === "ok" ? 200 : 503 });
});
