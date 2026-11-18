/**
 * Demolition Fund worker.
 *   npm run fund:worker            # loop
 *   npm run fund:worker -- --once  # single pass (cron-friendly)
 *
 * Each pass: scan the fund wallet for new fee receipts -> settle submitted swaps/burns ->
 * reconcile ledger vs chain -> run the executor (see fundPass in src/server/jobs.ts).
 * One pass at a time per database (advisory lock), so several workers cannot double-act.
 * On Cloudflare the same pass runs once a minute from the scheduled handler instead.
 */
import { prisma } from "../src/server/db";
import { fundPass } from "../src/server/jobs";
import { logger } from "../src/server/logger";

const once = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.FUND_WORKER_INTERVAL_MS ?? 60_000);
let stopping = false;

async function main() {
  if (once) {
    await fundPass();
    return;
  }
  while (!stopping) {
    await fundPass();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

main()
  .catch((err) => {
    logger.error({ err }, "fund worker crashed");
    process.exitCode = 1;
  })
  .finally(() => {
    if (once) void prisma.$disconnect();
  });
