/**
 * Background market-data synchronisation.
 *   npm run sync:markets            # loop every MARKET_POLL_INTERVAL_MS
 *   npm run sync:markets -- --once  # single pass (cron-friendly)
 * Read-only: it calls market-data providers and writes snapshots. It never signs or trades.
 */
import { getConfig } from "../src/server/config";
import { prisma } from "../src/server/db";
import { logger } from "../src/server/logger";
import { pruneSnapshots, syncMarkets } from "../src/server/services/market-sync";

const once = process.argv.includes("--once");
let stopping = false;

async function tick() {
  const started = Date.now();
  try {
    const r = await syncMarkets();
    logger.info({ ...r, missing: r.missing.length, ms: Date.now() - started }, "market sync complete");
  } catch (err) {
    logger.error({ err }, "market sync failed");
  }
}

async function main() {
  const cfg = getConfig();
  if (once) {
    await tick();
    await pruneSnapshots();
    return;
  }
  logger.info({ intervalMs: cfg.MARKET_POLL_INTERVAL_MS }, "market sync worker started");
  let n = 0;
  while (!stopping) {
    await tick();
    if (++n % 60 === 0) await pruneSnapshots().catch((err) => logger.error({ err }, "prune failed"));
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
