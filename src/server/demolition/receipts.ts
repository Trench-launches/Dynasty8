import "server-only";
import { Prisma, type AllocationMode } from "@prisma/client";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { logger } from "@/server/logger";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "@/server/services/audit";
import { isValidPublicKey } from "@/server/solana/address";
import { lamportDelta, type ChainTx } from "./chain";
import { getDemolitionDeps } from "./deps";
import { getFundConfig, getWallet, requireFundWallet } from "./fund";
import { applyBps, splitByBps, sumBig } from "./money";
import { distributeEventsIn, isSolQuote, sharingConfigAddress } from "./pump-fees";

/**
 * Creator-fee receipts. A receipt exists only when ALL of the following hold in a
 * finalized, successful transaction:
 *  1. Pump's program emitted a DistributeCreatorFeesEvent (inner instruction of the genuine
 *     Pump program; forged copies from other programs are ignored);
 *  2. the event's mint is a registered property token (by mint address, never ticker);
 *  3. the event's sharing config is the canonical PDA for that mint;
 *  4. the fees were paid in native SOL;
 *  5. the Demolition Fund wallet is one of its shareholders;
 *  6. every booked share actually arrived: each wallet's lamport balance rose by at least
 *     the shares attributed to it in that transaction.
 * Receipts are keyed (signature, event index), so re-observing a transaction is a no-op.
 *
 * Allocation modes (FundConfig.allocationMode):
 *  - ON_CHAIN_SPLIT (recommended): the sharing config pays FUND / ECOSYSTEM / OPERATIONS
 *    directly at buybackBps / ecosystemBps / operationsBps. The fund's share is 100% buyback;
 *    the other two shares are recorded as paid directly (nothing for the fund to disburse).
 *  - FUND_SPLITS: FUND is the only shareholder; its receipt is split by the bps and the
 *    ecosystem / operations shares are later disbursed from the fund (verified on-chain).
 */
export interface ReceiptResult {
  signature: string;
  created: number;
  duplicates: number;
  ignored: { reason: string; mint?: string }[];
  /** Booked, but the on-chain shareholder split differs from the configured split. */
  warnings: { reason: string; mint: string }[];
}

export class ReceiptRejected extends Error {}

export interface Candidate {
  eventIndex: number;
  mint: string;
  sharingConfig: string;
  distributed: bigint;
  shareBps: number;
  /** The fund's own share (lamports). */
  lamports: bigint;
  /** ON_CHAIN_SPLIT only: shares paid straight to the registered ecosystem / operations wallets. */
  directEcosystem: bigint;
  directOperations: bigint;
  splitMatches: boolean;
  tokenId: string;
  propertyId: string | null;
}

export interface ReceiptWallets {
  fund: string;
  ecosystem: string | null;
  operations: string | null;
}

export interface SplitConfig {
  mode: AllocationMode;
  buybackBps: number;
  ecosystemBps: number;
  operationsBps: number;
}

export function candidatesFromTx(
  tx: ChainTx,
  wallets: ReceiptWallets,
  registry: Map<string, { tokenId: string; propertyId: string | null }>,
  split: SplitConfig,
): { candidates: Candidate[]; ignored: ReceiptResult["ignored"]; warnings: ReceiptResult["warnings"] } {
  const ignored: ReceiptResult["ignored"] = [];
  const warnings: ReceiptResult["warnings"] = [];
  const candidates: Candidate[] = [];
  distributeEventsIn(tx).forEach((e, eventIndex) => {
    const holder = e.shareholders.find((s) => s.address === wallets.fund);
    if (!holder) return ignored.push({ reason: "fund_not_shareholder", mint: e.mint });
    const reg = registry.get(e.mint);
    if (!reg) return ignored.push({ reason: "unregistered_mint", mint: e.mint });
    if (e.sharingConfig !== sharingConfigAddress(e.mint)) return ignored.push({ reason: "sharing_config_mismatch", mint: e.mint });
    if (!isSolQuote(e.quoteMint)) return ignored.push({ reason: "non_sol_quote", mint: e.mint });
    if (new Set(e.shareholders.map((s) => s.address)).size !== e.shareholders.length) return ignored.push({ reason: "duplicate_shareholders", mint: e.mint });
    const lamports = applyBps(e.distributed, holder.shareBps);
    if (lamports <= 0n) return ignored.push({ reason: "zero_amount", mint: e.mint });

    let directEcosystem = 0n;
    let directOperations = 0n;
    let splitMatches: boolean;
    if (split.mode === "ON_CHAIN_SPLIT") {
      const eco = wallets.ecosystem ? e.shareholders.find((s) => s.address === wallets.ecosystem) : undefined;
      const ops = wallets.operations ? e.shareholders.find((s) => s.address === wallets.operations) : undefined;
      directEcosystem = eco ? applyBps(e.distributed, eco.shareBps) : 0n;
      directOperations = ops ? applyBps(e.distributed, ops.shareBps) : 0n;
      splitMatches =
        e.shareholders.length === 3 &&
        holder.shareBps === split.buybackBps &&
        eco?.shareBps === split.ecosystemBps &&
        ops?.shareBps === split.operationsBps;
    } else {
      splitMatches = e.shareholders.length === 1 && holder.shareBps === 10_000;
    }
    if (!splitMatches) warnings.push({ reason: "split_mismatch", mint: e.mint });
    candidates.push({ eventIndex, mint: e.mint, sharingConfig: e.sharingConfig, distributed: e.distributed, shareBps: holder.shareBps, lamports, directEcosystem, directOperations, splitMatches, tokenId: reg.tokenId, propertyId: reg.propertyId });
  });

  // The money must really have arrived, for every wallet we credit. Add back the network fee
  // if that wallet paid it.
  const arrived = (address: string) => lamportDelta(tx, address) + (tx.accountKeys[0] === address ? tx.fee : 0n);
  const check = (address: string | null, expected: bigint, role: string) => {
    if (!address || expected === 0n) return;
    const delta = arrived(address);
    if (delta < expected) throw new ReceiptRejected(`${role} balance rose by ${delta} lamports, less than the ${expected} attributed`);
  };
  if (candidates.length) {
    check(wallets.fund, sumBig(candidates.map((c) => c.lamports)), "Fund");
    check(wallets.ecosystem, sumBig(candidates.map((c) => c.directEcosystem)), "Ecosystem");
    check(wallets.operations, sumBig(candidates.map((c) => c.directOperations)), "Operations");
  }
  return { candidates, ignored, warnings };
}

async function propertyTokenRegistry() {
  const tokens = await prisma.token.findMany({ where: { isNative: false, mintAddress: { not: null } }, select: { id: true, mintAddress: true, propertyId: true } });
  return new Map(tokens.map((t) => [t.mintAddress!, { tokenId: t.id, propertyId: t.propertyId }]));
}

export class RpcUnavailable extends ApiError {
  constructor() {
    super(503, "INTERNAL", "Solana RPC unavailable; try again later");
  }
}

export async function verifyAndRecordReceipt(signature: string, source: "AUTO_SCAN" | "MANUAL", actor: Actor = SYSTEM_ACTOR): Promise<ReceiptResult> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new ApiError(400, "BAD_REQUEST", "Not a valid transaction signature");
  const fund = await requireFundWallet();
  const [eco, ops, cfg] = await Promise.all([getWallet("ECOSYSTEM"), getWallet("OPERATIONS"), getFundConfig()]);
  let tx: ChainTx | null;
  try {
    tx = await getDemolitionDeps().chain.getTransaction(signature);
  } catch {
    throw new RpcUnavailable();
  }
  if (!tx) throw new ApiError(422, "UNPROCESSABLE", "Transaction not found or not finalized yet");
  if (tx.err) throw new ApiError(422, "UNPROCESSABLE", "Transaction failed on-chain");

  let found: ReturnType<typeof candidatesFromTx>;
  try {
    found = candidatesFromTx(
      tx,
      { fund: fund.address, ecosystem: eco?.address ?? null, operations: ops?.address ?? null },
      await propertyTokenRegistry(),
      { mode: cfg.allocationMode, buybackBps: cfg.buybackBps, ecosystemBps: cfg.ecosystemBps, operationsBps: cfg.operationsBps },
    );
  } catch (e) {
    if (e instanceof ReceiptRejected) throw new ApiError(422, "UNPROCESSABLE", e.message);
    throw e;
  }

  const result: ReceiptResult = { signature, created: 0, duplicates: 0, ignored: found.ignored, warnings: found.warnings };
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
        const allocation =
          cfg.allocationMode === "ON_CHAIN_SPLIT"
            ? { buyback: c.lamports, ecosystem: c.directEcosystem, operations: c.directOperations, paidDirect: true }
            : { ...splitByBps(c.lamports, { buyback: cfg.buybackBps, ecosystem: cfg.ecosystemBps, operations: cfg.operationsBps }), paidDirect: false };
        await db.revenueAllocation.create({
          data: {
            receiptId: receipt.id,
            buybackLamports: allocation.buyback,
            ecosystemLamports: allocation.ecosystem,
            operationsLamports: allocation.operations,
            buybackBps: cfg.buybackBps,
            ecosystemBps: cfg.ecosystemBps,
            operationsBps: cfg.operationsBps,
            paidDirect: allocation.paidDirect,
          },
        });
        await recordAudit(db, actor, c.splitMatches ? "fund.receipt_recorded" : "fund.receipt_split_mismatch", "Token", c.tokenId, null, {
          signature,
          eventIndex: c.eventIndex,
          mint: c.mint,
          lamports: c.lamports,
          directEcosystem: c.directEcosystem,
          directOperations: c.directOperations,
          mode: cfg.allocationMode,
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
 * The cursor advances past a transaction only when it was processed (booked, ignored or
 * rejected on its own merits). Unfinalized transactions and RPC failures stop the scan
 * without advancing, so nothing is skipped (regression: an RPC outage used to be skipped).
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
  let stoppedEarly = false;
  let cursor = cfg.lastScannedSignature;
  for (const sig of pending.reverse()) {
    try {
      const r = await verifyAndRecordReceipt(sig, "AUTO_SCAN");
      created += r.created;
    } catch (e) {
      if (e instanceof RpcUnavailable || (e instanceof ApiError && e.message.startsWith("Transaction not found"))) {
        stoppedEarly = true;
        break; // retry from here next run
      }
      // Rejected on its own merits (e.g. money did not arrive): logged, never booked.
      logger.warn({ signature: sig, err: e instanceof Error ? e.message : "unknown" }, "receipt scan skipped transaction");
    }
    cursor = sig;
    processed++;
  }
  if (cursor !== cfg.lastScannedSignature) await prisma.fundConfig.update({ where: { id: 1 }, data: { lastScannedSignature: cursor } });
  return { scanned: processed, created, stoppedEarly };
}

export function assertSignature(s: unknown): string {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s)) throw new ApiError(400, "BAD_REQUEST", "Not a valid transaction signature");
  return s;
}

export { isValidPublicKey };
