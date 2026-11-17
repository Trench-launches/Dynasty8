/**
 * Demolition Fund worker.
 *   npm run fund:worker            # loop
 *   npm run fund:worker -- --once  # single pass (cron-friendly)
 *
 * Each pass: scan the fund wallet for new fee receipts -> settle submitted swaps/burns ->
 * reconcile ledger vs chain -> run the executor (inert unless automated execution is
 * enabled by the owner AND a real signer is configured; neither is true in this release).
 * One pass at a time per database (advisory lock), so several workers cannot double-act.
 */
import { prisma } from "../src/server/db";
import { logger } from "../src/server/logger";
import { settleAll } from "../src/server/demolition/buyback";
import { createRpcTxSender, runExecutor } from "../src/server/demolition/executor";
import { getWallet } from "../src/server/demolition/fund";
import { scanFundWallet } from "../src/server/demolition/receipts";
import { reconcile } from "../src/server/demolition/reconcile";

const once = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.FUND_WORKER_INTERVAL_MS ?? 60_000);
let stopping = false;

async function pass() {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(830143) AS locked`;
  if (!locked) {
    logger.info("another fund worker holds the lock; skipping pass");
    return;
  }
  try {
    if (!(await getWallet("FUND"))) {
      logger.info("no fund wallet registered; nothing to do");
      return;
    }
    const scan = await scanFundWallet();
    const settled = await settleAll();
    const rec = await reconcile();
    const exec = await runExecutor(createRpcTxSender());
    logger.info({ scan, settled, reconciled: rec.ok, exec }, "fund worker pass complete");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "unknown" }, "fund worker pass failed");
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(830143)`;
  }
}

async function main() {
  if (once) return pass();
  while (!stopping) {
    await pass();
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
