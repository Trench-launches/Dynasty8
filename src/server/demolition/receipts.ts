import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { logger } from "@/server/logger";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "@/server/services/audit";
import { isValidPublicKey } from "@/server/solana/address";
import { lamportDelta, type ChainTx } from "./chain";
import { getDemolitionDeps } from "./deps";
import { getFundConfig, requireFundWallet } from "./fund";
import { applyBps, splitByBps, sumBig } from "./money";
import { distributeEventsIn, sharingConfigAddress } from "./pump-fees";

/**
 * Creator-fee receipts. A receipt exists only when ALL of the following hold in a
 * finalized, successful transaction:
 *  1. Pump's program emitted a DistributeCreatorFeesEvent;
 *  2. the event's mint is a registered property token (by mint address, never ticker);
 *  3. the event's sharing config is the canonical PDA for that mint;
 *  4. the Demolition Fund wallet is one of its shareholders;
 *  5. the fund's lamport balance actually rose by at least the sum of its shares.
 * Receipts are keyed (signature, event index), so re-observing a transaction is a no-op.
 */
export interface ReceiptResult {
  signature: string;
  created: number;
  duplicates: number;
  ignored: { reason: string; mint?: string }[];
}

export class ReceiptRejected extends Error {}

interface Candidate {
  eventIndex: number;
  mint: string;
  sharingConfig: string;
  distributed: bigint;
  shareBps: number;
  lamports: bigint;
  tokenId: string;
  propertyId: string | null;
}

export function candidatesFromTx(
  tx: ChainTx,
  fund: string,
  registry: Map<string, { tokenId: string; propertyId: string | null }>,
): { candidates: Candidate[]; ignored: ReceiptResult["ignored"] } {
  const ignored: ReceiptResult["ignored"] = [];
  const candidates: Candidate[] = [];
  distributeEventsIn(tx).forEach((e, eventIndex) => {
    const holder = e.shareholders.find((s) => s.address === fund);
    if (!holder) return ignored.push({ reason: "fund_not_shareholder", mint: e.mint });
    const reg = registry.get(e.mint);
    if (!reg) return ignored.push({ reason: "unregistered_mint", mint: e.mint });
    if (e.sharingConfig !== sharingConfigAddress(e.mint)) return ignored.push({ reason: "sharing_config_mismatch", mint: e.mint });
    const lamports = applyBps(e.distributed, holder.shareBps);
    if (lamports <= 0n) return ignored.push({ reason: "zero_amount", mint: e.mint });
    candidates.push({ eventIndex, mint: e.mint, sharingConfig: e.sharingConfig, distributed: e.distributed, shareBps: holder.shareBps, lamports, tokenId: reg.tokenId, propertyId: reg.propertyId });
  });
  // The money must really have arrived. If the fund paid the network fee, add it back.
  if (candidates.length) {
    let delta = lamportDelta(tx, fund);
    if (tx.accountKeys[0] === fund) delta += tx.fee;
    const expected = sumBig(candidates.map((c) => c.lamports));
    if (delta < expected) {
      throw new ReceiptRejected(`Fund balance rose by ${delta} lamports, less than the ${expected} attributed`);
    }
  }
  return { candidates, ignored };
}

async function propertyTokenRegistry() {
  const tokens = await prisma.token.findMany({ where: { isNative: false, mintAddress: { not: null } }, select: { id: true, mintAddress: true, propertyId: true } });
  return new Map(tokens.map((t) => [t.mintAddress!, { tokenId: t.id, propertyId: t.propertyId }]));
}

export async function verifyAndRecordReceipt(signature: string, source: "AUTO_SCAN" | "MANUAL", actor: Actor = SYSTEM_ACTOR): Promise<ReceiptResult> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new ApiError(400, "BAD_REQUEST", "Not a valid transaction signature");
  const fund = await requireFundWallet();
  let tx: ChainTx | null;
  try {
    tx = await getDemolitionDeps().chain.getTransaction(signature);
  } catch {
    throw new ApiError(503, "INTERNAL", "Solana RPC unavailable; try again later");
  }
  if (!tx) throw new ApiError(422, "UNPROCESSABLE", "Transaction not found or not finalized yet");
  if (tx.err) throw new ApiError(422, "UNPROCESSABLE", "Transaction failed on-chain");

  let found: ReturnType<typeof candidatesFromTx>;
  try {
    found = candidatesFromTx(tx, fund.address, await propertyTokenRegistry());
  } catch (e) {
    if (e instanceof ReceiptRejected) throw new ApiError(422, "UNPROCESSABLE", e.message);
    throw e;
  }

  const result: ReceiptResult = { signature, created: 0, duplicates: 0, ignored: found.ignored };
  if (!found.candidates.length) return result;

  const cfg = await getFundConfig();
  for (const c of found.candidates) {
    try {
      await prisma.$transaction(async (db) => {
        const receipt = await db.feeReceipt.create({
          data: {
            signature,
            eventIndex: c.eventIndex,
            propertyId: c.propertyId,
            tokenId: c.tokenId,
            mint: c.mint,
            sharingConfig: c.sharingConfig,
            recipient: fund.address,
            lamports: c.lamports,
            distributedTotal: c.distributed,
            shareBps: c.shareBps,
            slot: tx.slot,
            blockTime: tx.blockTime,
            source,
            recordedById: actor.id,
          },
        });
        const split = splitByBps(c.lamports, { buyback: cfg.buybackBps, ecosystem: cfg.ecosystemBps, operations: cfg.operationsBps });
        await db.revenueAllocation.create({
          data: {
            receiptId: receipt.id,
            buybackLamports: split.buyback,
            ecosystemLamports: split.ecosystem,
            operationsLamports: split.operations,
            buybackBps: cfg.buybackBps,
            ecosystemBps: cfg.ecosystemBps,
            operationsBps: cfg.operationsBps,
          },
        });
        await recordAudit(db, actor, "fund.receipt_recorded", "Token", c.tokenId, null, {
          signature,
          eventIndex: c.eventIndex,
          mint: c.mint,
          lamports: c.lamports.toString(),
          source,
        });
      });
      result.created++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        result.duplicates++;
        continue;
      }
      throw e;
    }
  }
  return result;
}

/**
 * Scans the fund wallet's finalized history newer than the stored cursor, oldest first.
 * The cursor only advances past transactions that were fully processed.
 */
export async function scanFundWallet(maxPages = 10, pageSize = 100) {
  const fund = await requireFundWallet();
  const cfg = await getFundConfig();
  const { chain } = getDemolitionDeps();
  const pending: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await chain.getSignaturesForAddress(fund.address, { until: cfg.lastScannedSignature ?? undefined, before, limit: pageSize });
    pending.push(...sigs.filter((s) => !s.err).map((s) => s.signature));
    if (sigs.length < pageSize) break;
    before = sigs[sigs.length - 1]!.signature;
  }
  let processed = 0;
  let created = 0;
  let cursor = cfg.lastScannedSignature;
  for (const sig of pending.reverse()) {
    try {
      const r = await verifyAndRecordReceipt(sig, "AUTO_SCAN");
      created += r.created;
    } catch (e) {
      if (e instanceof ApiError && e.message.startsWith("Transaction not found")) break; // retry next run
      // A rejected transaction (e.g. balance mismatch) is logged and skipped, never booked.
      logger.warn({ signature: sig, err: e instanceof Error ? e.message : "unknown" }, "receipt scan skipped transaction");
    }
    cursor = sig;
    processed++;
  }
  if (cursor !== cfg.lastScannedSignature) await prisma.fundConfig.update({ where: { id: 1 }, data: { lastScannedSignature: cursor } });
  return { scanned: processed, created };
}

export function assertSignature(s: unknown): string {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s)) throw new ApiError(400, "BAD_REQUEST", "Not a valid transaction signature");
  return s;
}

export { isValidPublicKey };
