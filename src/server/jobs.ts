import "server-only";
import { prisma } from "@/server/db";
import { logger } from "@/server/logger";
import { settleAll } from "@/server/demolition/buyback";
import { createRpcTxSender, runExecutor } from "@/server/demolition/executor";
import { getWallet } from "@/server/demolition/fund";
import { scanFundWallet } from "@/server/demolition/receipts";
import { reconcile } from "@/server/demolition/reconcile";
import { pruneSnapshots, syncMarkets } from "@/server/services/market-sync";

/**
 * Background jobs, one pass each. Run by the long-lived Node workers (scripts/sync-worker.ts,
 * scripts/demolition-worker.ts) and, on Cloudflare, once a minute by the scheduled handler
 * (custom-worker.ts -> /api/internal/tick).
 */

/** One market-data sync. Snapshot pruning is optional (the callers run it about hourly). */
export async function marketSyncPass({ prune = false } = {}) {
  const started = Date.now();
  try {
    const r = await syncMarkets();
    logger.info({ ...r, missing: r.missing.length, ms: Date.now() - started }, "market sync complete");
    if (prune) await pruneSnapshots().catch((err) => logger.error({ err }, "prune failed"));
    return { ok: true as const, snapshots: r.snapshots, missing: r.missing.length };
  } catch (err) {
    logger.error({ err }, "market sync failed");
    return { ok: false as const };
  }
}

/** Longest a fund pass may hold its lock (RPC scans can be slow). */
const FUND_PASS_TIMEOUT_MS = 5 * 60_000;

/**
 * One Demolition Fund pass: scan the fund wallet for new fee receipts -> settle submitted
 * swaps/burns -> reconcile ledger vs chain -> run the executor (inert unless automated execution
 * is enabled by the owner AND a real signer is configured; neither is true in this release).
 *
 * Only one pass runs at a time per database (advisory lock 830143). The lock is transaction-scoped, so it is released
 * when the pass ends even through a connection pooler (Hyperdrive, Neon), where a session lock
 * could stay with a pooled connection and block every later pass.
 */
export async function fundPass() {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(830143) AS locked`;
      if (!locked) {
        logger.info("another fund pass holds the lock; skipping");
        return { ran: false as const, reason: "locked" };
      }
      try {
        if (!(await getWallet("FUND"))) {
          logger.info("no fund wallet registered; nothing to do");
          return { ran: false as const, reason: "no fund wallet" };
        }
        const scan = await scanFundWallet();
        const settled = await settleAll();
        const rec = await reconcile();
        const exec = await runExecutor(createRpcTxSender());
        logger.info({ scan, settled, reconciled: rec.ok, exec }, "fund worker pass complete");
        return { ran: true as const, reconciled: rec.ok };
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : "unknown" }, "fund worker pass failed");
        return { ran: false as const, reason: "failed" };
      }
    },
    { maxWait: 10_000, timeout: FUND_PASS_TIMEOUT_MS },
  );
}
