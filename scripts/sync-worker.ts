/**
 * Background market-data synchronisation.
 *   npm run sync:markets            # loop every MARKET_POLL_INTERVAL_MS
 *   npm run sync:markets -- --once  # single pass (cron-friendly)
 * Read-only: it calls market-data providers and writes snapshots. It never signs or trades.
 * On Cloudflare the same pass runs once a minute from the scheduled handler instead.
 */
import { getConfig } from "../src/server/config";
import { prisma } from "../src/server/db";
import { marketSyncPass } from "../src/server/jobs";
import { logger } from "../src/server/logger";

const once = process.argv.includes("--once");
let stopping = false;

async function main() {
  const cfg = getConfig();
  if (once) {
    await marketSyncPass({ prune: true });
    return;
  }
  logger.info({ intervalMs: cfg.MARKET_POLL_INTERVAL_MS }, "market sync worker started");
  let n = 0;
  while (!stopping) {
    await marketSyncPass({ prune: ++n % 60 === 0 });
    await new Promise((r) => setTimeout(r, cfg.MARKET_POLL_INTERVAL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    logger.info({ sig }, "stopping market sync worker");
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

main()
  .catch((err) => {
    logger.error({ err }, "worker crashed");
    process.exitCode = 1;
  })
  .finally(() => {
    if (once) void prisma.$disconnect();
  });
