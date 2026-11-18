/**
 * Demolition Fund worker.
 *   npm run fund:worker            # loop
 *   npm run fund:worker -- --once  # single pass (cron-friendly)
 *
 * Each pass: scan the fund wallet for new fee receipts -> sync Squads proposals (approvals,
 * execution) -> settle submitted swaps/burns -> reconcile ledger vs chain -> hourly on-chain
 * check of every property's Pump fee-sharing config -> run the executor (inert unless
 * automated execution is enabled by the owner AND a real signer is configured; neither is
 * true in this release). One worker at a time per database (pool-safe lease).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/server/db";
import { logger } from "../src/server/logger";
import { settleAll } from "../src/server/demolition/buyback";
import { createRpcTxSender, runExecutor } from "../src/server/demolition/executor";
import { checkFeeSharing } from "../src/server/demolition/fee-sharing";
import { getFundConfig, getWallet } from "../src/server/demolition/fund";
import { acquireLease, releaseLease } from "../src/server/demolition/lease";
import { syncAllProposals } from "../src/server/demolition/proposals";
import { scanFundWallet } from "../src/server/demolition/receipts";
import { reconcile } from "../src/server/demolition/reconcile";

const once = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.FUND_WORKER_INTERVAL_MS ?? 60_000);
const OWNER = `worker-${randomUUID()}`;
const FEE_SHARING_EVERY_MS = 60 * 60_000;
let stopping = false;

async function pass() {
  if (!(await acquireLease(OWNER, Math.max(INTERVAL_MS * 3, 180_000)))) {
    logger.info("another fund worker holds the lease; skipping pass");
    return;
  }
  try {
    if (!(await getWallet("FUND"))) {
      logger.info("no fund wallet registered; nothing to do");
      return;
    }
    const scan = await scanFundWallet();
    const proposals = await syncAllProposals();
    const settled = await settleAll();
    const rec = await reconcile();
    const cfg = await getFundConfig();
    let feeSharing: unknown = "skipped";
    if (!cfg.lastFeeSharingCheckAt || Date.now() - cfg.lastFeeSharingCheckAt.getTime() > FEE_SHARING_EVERY_MS) {
      feeSharing = await checkFeeSharing();
      await prisma.fundConfig.update({ where: { id: 1 }, data: { lastFeeSharingCheckAt: new Date() } });
    }
    const exec = await runExecutor(createRpcTxSender());
    logger.info({ scan, proposals, settled, reconciled: rec.ok, feeSharing, exec }, "fund worker pass complete");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "unknown" }, "fund worker pass failed");
  }
}

async function main() {
  if (once) {
    await pass();
    await releaseLease(OWNER);
    return;
  }
  while (!stopping) {
    await pass();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    void releaseLease(OWNER)
      .catch(() => {})
      .finally(() => prisma.$disconnect().finally(() => process.exit(0)));
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
