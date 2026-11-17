import "server-only";
import type { BuybackRequest, Prisma } from "@prisma/client";
import { PublicKey } from "@solana/web3.js";
import { getConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { ProviderError } from "@/server/http/fetch-json";
import { ApiError } from "@/server/http/responses";
import { getProviders } from "@/server/providers/registry";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "@/server/services/audit";
import { PROGRAMS } from "@/server/solana/address";
import { lamportDelta, tokenDelta, type ChainTx } from "./chain";
import { getDemolitionDeps } from "./deps";
import { assertOperational, getFundConfig, openCircuit, recordFailure, recordSuccess, requireFundWallet, requireTargetToken } from "./fund";
import { QuoteRejected, WSOL_MINT, type SwapBuild } from "./jupiter";
import { minBig, sumBig } from "./money";
import { assertBurnAllowed, assertSwapAllowed, PolicyViolation } from "./policy";

/**
 * Buyback & burn state machine (durable, in PostgreSQL):
 *
 *   PLANNED -> QUOTED -> APPROVED -> SWAP_SUBMITTED -> SWAP_CONFIRMED -> BURN_SUBMITTED -> BURNED
 *                  ^          ^            |                   ^               |
 *                  |          +------------+ (failed/expired)  +---------------+ (failed burn,
 *                  |                                               tokens retained, retry burn)
 *   PLANNED/QUOTED/APPROVED -> CANCELLED
 *
 * - Every transition is a compare-and-set on the current status, so concurrent workers or
 *   repeated API calls cannot double-execute (idempotent).
 * - A signature is recorded (ChainTransaction, unique) BEFORE broadcast or when reported by
 *   the multisig, and only finalized on-chain data moves a request forward.
 * - Once SWAP_CONFIRMED, the request can only burn. A failed burn returns it to
 *   SWAP_CONFIRMED with the purchased tokens still accounted for; a second swap is impossible.
 */
const ACTIVE: BuybackRequest["status"][] = ["PLANNED", "QUOTED", "APPROVED", "SWAP_SUBMITTED", "SWAP_CONFIRMED", "BURN_SUBMITTED"];
const QUOTE_MAX_AGE_MS = 10 * 60_000;
/** Extra SOL a swap may cost beyond the budget (ATA rent, network fee). */
const SWAP_OVERHEAD_LAMPORTS = 10_000_000n;
/** A submitted transaction with no status after this long is treated as expired. */
const SUBMISSION_EXPIRY_MS = 5 * 60_000;

type Db = Prisma.TransactionClient;

/**
 * A submission counts as dead only when it can no longer land: for transactions we
 * broadcast (lastValidBlockHeight known) the chain must be past that height; for
 * signatures reported by the multisig (already executed) an unknown signature after
 * the grace period means it never existed. This prevents re-buying while an old swap
 * could still confirm.
 */
async function submissionDead(record: { submittedAt: Date; lastValidBlockHeight: bigint | null } | null, statusKnown: boolean) {
  if (statusKnown || !record) return false;
  const { chain, now } = getDemolitionDeps();
  if (record.lastValidBlockHeight !== null) return (await chain.getBlockHeight()) > record.lastValidBlockHeight;
  return now().getTime() - record.submittedAt.getTime() > SUBMISSION_EXPIRY_MS;
}


async function lockFund(db: Db) {
  // Serialises budget reservation across processes.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(830142)`;
}

async function transition(db: Db, id: string, from: BuybackRequest["status"][], data: Prisma.BuybackRequestUpdateInput) {
  const { count } = await db.buybackRequest.updateMany({ where: { id, status: { in: from } }, data: data as Prisma.BuybackRequestUpdateManyMutationInput });
  if (count !== 1) throw new ApiError(409, "CONFLICT", `Buyback is not in state ${from.join(" or ")}`);
}

export async function getRequest(id: string, db: Db | typeof prisma = prisma) {
  const r = await db.buybackRequest.findUnique({ where: { id }, include: { fundings: true, approvals: true, transactions: true } });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Buyback request not found");
  return r;
}

// ── Budget ──────────────────────────────────────────────────────────────────

/** Buyback allocations not yet reserved by a request, oldest first. */
async function unreservedAllocations(db: Db | typeof prisma) {
  const allocs = await db.revenueAllocation.findMany({
    where: { buybackLamports: { gt: 0 } },
    include: { fundings: true },
    orderBy: { createdAt: "asc" },
  });
  return allocs
    .map((a) => ({ id: a.id, remaining: a.buybackLamports - sumBig(a.fundings.map((f) => f.lamports)) }))
    .filter((a) => a.remaining > 0n);
}

export async function pendingBuybackLamports(db: Db | typeof prisma = prisma) {
  return sumBig((await unreservedAllocations(db)).map((a) => a.remaining));
}

async function spentLast24h(db: Db, now: Date) {
  const since = new Date(now.getTime() - 86_400_000);
  const rows = await db.buybackRequest.findMany({ where: { createdAt: { gte: since }, status: { notIn: ["CANCELLED", "FAILED"] } }, select: { budgetLamports: true } });
  return sumBig(rows.map((r) => r.budgetLamports));
}

// ── Create / quote / approve ────────────────────────────────────────────────

export async function createBuybackRequest(input: { idempotencyKey: string; budgetLamports?: bigint }, actor: Actor) {
  const existing = await prisma.buybackRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing; // idempotent replay

  const { chain, now } = getDemolitionDeps();
  const fund = await requireFundWallet();
  const target = await requireTargetToken();
  const balance = await chain.getBalance(fund.address); // read outside the DB transaction

  return prisma.$transaction(async (db) => {
    await lockFund(db);
    const again = await db.buybackRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (again) return again;
    const cfg = await getFundConfig(db);
    assertOperational(cfg);
    if (await db.buybackRequest.count({ where: { status: { in: ACTIVE } } })) {
      throw new ApiError(409, "CONFLICT", "Another buyback is still in progress");
    }
    const last = await db.buybackRequest.findFirst({ where: { swapConfirmedAt: { not: null } }, orderBy: { swapConfirmedAt: "desc" } });
    const t = now();
    if (last?.swapConfirmedAt && t.getTime() - last.swapConfirmedAt.getTime() < cfg.cooldownSeconds * 1000) {
      throw new ApiError(429, "RATE_LIMITED", "Buyback cooldown has not elapsed");
    }
    const allocs = await unreservedAllocations(db);
    const pending = sumBig(allocs.map((a) => a.remaining));
    const dailyLeft = cfg.maxDailyBuybackLamports - (await spentLast24h(db, t));
    const spendable = balance - cfg.reserveLamports;
    const budget = minBig(input.budgetLamports ?? pending, pending, cfg.maxBuybackLamportsPerTx, dailyLeft, spendable);
    if (budget < cfg.minBuybackLamports) {
      const why =
        pending < cfg.minBuybackLamports ? "Not enough verified buyback revenue" :
        dailyLeft < cfg.minBuybackLamports ? "Daily buyback budget exhausted" :
        spendable < cfg.minBuybackLamports ? "Insufficient SOL in the fund wallet after the reserve" :
        "Budget below the minimum buyback size";
      throw new ApiError(422, "UNPROCESSABLE", why);
    }
    const req = await db.buybackRequest.create({
      data: { idempotencyKey: input.idempotencyKey, targetMint: target.mintAddress, budgetLamports: budget, slippageBps: cfg.slippageBps, createdById: actor.id },
    });
    // Reserve allocations FIFO so every lamport traces to receipts (and properties).
    let left = budget;
    for (const a of allocs) {
      if (left === 0n) break;
      const take = minBig(a.remaining, left);
      await db.buybackFunding.create({ data: { requestId: req.id, allocationId: a.id, lamports: take } });
      left -= take;
    }
    await recordAudit(db, actor, "buyback.create", "Buyback", req.id, null, req);
    return req;
  });
}

async function liquidityOk(minUsd: number) {
  const target = await requireTargetToken();
  const snap = await prisma.marketSnapshot.findFirst({ where: { tokenId: target.id }, orderBy: { fetchedAt: "desc" } });
  const fresh = snap && Date.now() - snap.fetchedAt.getTime() <= getConfig().MARKET_STALE_AFTER_MS;
  if (!fresh) throw new ApiError(422, "UNPROCESSABLE", "No fresh liquidity data for the native token");
  if (snap!.liquidityUsd === null || snap!.liquidityUsd < minUsd) {
    throw new ApiError(422, "UNPROCESSABLE", `Liquidity below the ${minUsd} USD minimum`);
  }
}

async function buildSwap(req: BuybackRequest): Promise<SwapBuild> {
  const cfg = await getFundConfig();
  const fund = await requireFundWallet();
  await liquidityOk(cfg.minLiquidityUsd);
  let build: SwapBuild;
  try {
    build = await getDemolitionDeps().swap.build({ inputMint: WSOL_MINT, outputMint: req.targetMint, amount: req.budgetLamports, taker: fund.address, slippageBps: req.slippageBps });
  } catch (e) {
    if (e instanceof QuoteRejected) throw new ApiError(422, "UNPROCESSABLE", e.message);
    if (e instanceof ProviderError) throw new ApiError(503, "INTERNAL", `Swap quote unavailable (${e.kind})`);
    throw e;
  }
  try {
    assertSwapAllowed(build, {
      fundWallet: fund.address,
      targetMint: req.targetMint,
      budgetLamports: req.budgetLamports,
      maxPriceImpactBps: cfg.maxPriceImpactBps,
      slippageBps: req.slippageBps,
      swapPrograms: getConfig().BUYBACK_SWAP_PROGRAMS.split(",").map((s) => s.trim()).filter(Boolean),
    });
  } catch (e) {
    if (e instanceof PolicyViolation) throw new ApiError(422, "UNPROCESSABLE", e.message);
    throw e;
  }
  return build;
}

export async function quoteBuyback(id: string, actor: Actor) {
  const req = await getRequest(id);
  assertOperational(await getFundConfig());
  if (req.status !== "PLANNED" && req.status !== "QUOTED") throw new ApiError(409, "CONFLICT", "Only planned or quoted buybacks can be (re)quoted");
  const build = await buildSwap(req);
  return prisma.$transaction(async (db) => {
    await transition(db, id, ["PLANNED", "QUOTED"], {
      status: "QUOTED",
      quoteSource: build.source,
      quotedInLamports: build.inAmount,
      quotedOutRaw: build.outAmount,
      minOutRaw: build.minOut,
      priceImpactBps: build.priceImpactBps,
      routeLabels: build.routeLabels.join(" > ").slice(0, 300),
      quotedAt: getDemolitionDeps().now(),
    });
    // Re-quoting resets approvals: they were for different numbers.
    await db.buybackApproval.deleteMany({ where: { requestId: id } });
    const after = await getRequest(id, db);
    await recordAudit(db, actor, "buyback.quote", "Buyback", id, null, { out: build.outAmount, minOut: build.minOut, impactBps: build.priceImpactBps });
    return after;
  });
}

export async function approveBuyback(id: string, adminId: string, note: string | undefined, actor: Actor) {
  const cfg = await getFundConfig();
  assertOperational(cfg);
  const req = await getRequest(id);
  if (req.status !== "QUOTED") throw new ApiError(409, "CONFLICT", "Only quoted buybacks can be approved");
  if (!req.quotedAt || getDemolitionDeps().now().getTime() - req.quotedAt.getTime() > QUOTE_MAX_AGE_MS) {
    throw new ApiError(422, "UNPROCESSABLE", "Quote is older than 10 minutes; re-quote first");
  }
  const fund = await requireFundWallet();
  const balance = await getDemolitionDeps().chain.getBalance(fund.address);
  if (balance < req.budgetLamports + cfg.reserveLamports) throw new ApiError(422, "UNPROCESSABLE", "Insufficient SOL in the fund wallet");
  return prisma.$transaction(async (db) => {
    try {
      await db.buybackApproval.create({ data: { requestId: id, adminId, note } });
    } catch {
      throw new ApiError(409, "CONFLICT", "You already approved this buyback");
    }
    const n = await db.buybackApproval.count({ where: { requestId: id } });
    if (n >= cfg.requiredApprovals) await transition(db, id, ["QUOTED"], { status: "APPROVED" });
    await recordAudit(db, actor, "buyback.approve", "Buyback", id, null, { approvals: n, required: cfg.requiredApprovals });
    return getRequest(id, db);
  });
}

export async function cancelBuyback(id: string, reason: string, actor: Actor) {
  return prisma.$transaction(async (db) => {
    await transition(db, id, ["PLANNED", "QUOTED", "APPROVED"], { status: "CANCELLED", failureReason: reason });
    await db.buybackFunding.deleteMany({ where: { requestId: id } }); // release the reserved revenue
    await recordAudit(db, actor, "buyback.cancel", "Buyback", id, null, { reason });
    return getRequest(id, db);
  });
}

// ── Swap ────────────────────────────────────────────────────────────────────

/** Re-builds and policy-checks the swap for the approved request. Used for the multisig proposal and the executor. */
export async function swapProposal(id: string) {
  assertOperational(await getFundConfig());
  const req = await getRequest(id);
  if (req.status !== "APPROVED") throw new ApiError(409, "CONFLICT", "Buyback is not approved");
  const build = await buildSwap(req);
  if (req.minOutRaw !== null && build.minOut < req.minOutRaw) {
    throw new ApiError(422, "UNPROCESSABLE", "Price moved below the approved minimum output; re-quote and re-approve");
  }
  return { request: req, build };
}

export async function recordSwapSubmission(id: string, signature: string, actor: Actor, lastValidBlockHeight?: bigint) {
  return prisma.$transaction(async (db) => {
    const used = await db.chainTransaction.findUnique({ where: { signature } });
    if (used) throw new ApiError(409, "CONFLICT", "This signature is already recorded");
    await transition(db, id, ["APPROVED"], { status: "SWAP_SUBMITTED", swapSignature: signature, swapAttempts: { increment: 1 } });
    await db.chainTransaction.create({ data: { signature, purpose: "SWAP", requestId: id, lastValidBlockHeight } });
    await recordAudit(db, actor, "buyback.swap_submitted", "Buyback", id, null, { signature });
    return getRequest(id, db);
  });
}

export interface SwapVerification {
  ok: boolean;
  reason?: string;
  spent: bigint;
  received: bigint;
}

export function verifySwapTx(tx: ChainTx, p: { fund: string; targetMint: string; budget: bigint; minOut: bigint | null; notBefore: Date }): SwapVerification {
  if (tx.err) return { ok: false, reason: "Transaction failed on-chain", spent: 0n, received: 0n };
  const received = tokenDelta(tx, p.fund, p.targetMint);
  // SOL leaves either directly or via the fund's WSOL account.
  let spent = -lamportDelta(tx, p.fund) - tokenDelta(tx, p.fund, WSOL_MINT);
  if (tx.accountKeys[0] === p.fund) spent -= tx.fee; // network fee is not buyback spend
  if (tx.blockTime && tx.blockTime.getTime() < p.notBefore.getTime()) return { ok: false, reason: "Transaction predates this buyback", spent, received };
  if (received <= 0n) return { ok: false, reason: "No target tokens reached the fund", spent, received };
  if (p.minOut !== null && received < p.minOut) return { ok: false, reason: "Received less than the approved minimum", spent, received };
  if (spent <= 0n) return { ok: false, reason: "No SOL left the fund", spent, received };
  if (spent > p.budget + SWAP_OVERHEAD_LAMPORTS) return { ok: false, reason: "Swap spent more than the approved budget", spent, received };
  return { ok: true, spent: minBig(spent, p.budget), received };
}

/** Moves a SWAP_SUBMITTED request forward based on finalized chain data. Safe to call repeatedly. */
export async function settleSwap(id: string) {
  const req = await getRequest(id);
  if (req.status !== "SWAP_SUBMITTED" || !req.swapSignature) return req;
  const { chain, now } = getDemolitionDeps();
  const fund = await requireFundWallet();
  const sig = req.swapSignature;
  const tx = await chain.getTransaction(sig);
  const record = await prisma.chainTransaction.findUnique({ where: { signature: sig } });

  if (!tx) {
    const state = await chain.getSignatureState(sig);
    if (await submissionDead(record, state.status !== null)) {
      return prisma.$transaction(async (db) => {
        await db.chainTransaction.update({ where: { signature: sig }, data: { status: "EXPIRED", resolvedAt: now() } });
        await transition(db, id, ["SWAP_SUBMITTED"], { status: "APPROVED", swapSignature: null, failureReason: "Swap transaction expired" });
        await recordFailure(db, "swap expired");
        return getRequest(id, db);
      });
    }
    return req; // still pending (confirmation delay)
  }

  const v = verifySwapTx(tx, { fund: fund.address, targetMint: req.targetMint, budget: req.budgetLamports, minOut: req.minOutRaw, notBefore: new Date(req.createdAt.getTime() - 60_000) });
  return prisma.$transaction(async (db) => {
    if (!v.ok) {
      await db.chainTransaction.update({ where: { signature: sig }, data: { status: "FAILED", error: v.reason, slot: tx.slot, resolvedAt: now() } });
      await transition(db, id, ["SWAP_SUBMITTED"], { status: "APPROVED", swapSignature: null, failureReason: v.reason });
      await recordFailure(db, `swap: ${v.reason}`);
      // A transaction that succeeded on-chain but does not match the approval is suspicious.
      if (!tx.err) await openCircuit(db, `Swap ${sig} did not match its approval: ${v.reason}`);
      await recordAudit(db, SYSTEM_ACTOR, "buyback.swap_failed", "Buyback", id, null, { signature: sig, reason: v.reason });
      return getRequest(id, db);
    }
    await db.chainTransaction.update({ where: { signature: sig }, data: { status: "FINALIZED", slot: tx.slot, amount: v.received, resolvedAt: now() } });
    await transition(db, id, ["SWAP_SUBMITTED"], { status: "SWAP_CONFIRMED", solSpentLamports: v.spent, tokensReceivedRaw: v.received, swapConfirmedAt: now(), failureReason: null });
    await shrinkFundings(db, id, v.spent);
    await recordSuccess(db);
    await recordAudit(db, SYSTEM_ACTOR, "buyback.swap_confirmed", "Buyback", id, null, { signature: sig, spent: v.spent, received: v.received });
    return getRequest(id, db);
  });
}

/** Releases unspent budget back to the pending pool (newest reservation first). */
async function shrinkFundings(db: Db, requestId: string, spent: bigint) {
  const fundings = await db.buybackFunding.findMany({ where: { requestId }, orderBy: { id: "desc" } });
  let excess = sumBig(fundings.map((f) => f.lamports)) - spent;
  for (const f of fundings) {
    if (excess <= 0n) break;
    if (f.lamports <= excess) {
      await db.buybackFunding.delete({ where: { id: f.id } });
      excess -= f.lamports;
    } else {
      await db.buybackFunding.update({ where: { id: f.id }, data: { lamports: f.lamports - excess } });
      excess = 0n;
    }
  }
}

// ── Burn ────────────────────────────────────────────────────────────────────

export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string) {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  )[0].toBase58();
}

/** BurnChecked of exactly the purchased, not-yet-burned tokens. Never more. */
export async function burnProposal(id: string) {
  const req = await getRequest(id);
  if (req.status !== "SWAP_CONFIRMED" || req.tokensReceivedRaw === null) throw new ApiError(409, "CONFLICT", "Buyback has no confirmed, unburned tokens");
  const amount = req.tokensReceivedRaw - req.tokensBurnedRaw;
  if (amount <= 0n) throw new ApiError(409, "CONFLICT", "Nothing left to burn");
  const fund = await requireFundWallet();
  const target = await requireTargetToken();
  const mintInfo = await getProviders().solana.getMintInfo(target.mintAddress);
  if (!mintInfo.exists || !mintInfo.program) throw new ApiError(422, "UNPROCESSABLE", "Target mint not found on-chain");
  const tokenProgram = mintInfo.program === "TOKEN_2022" ? PROGRAMS.TOKEN_2022 : PROGRAMS.TOKEN;
  const held = await getDemolitionDeps().chain.getTokenBalance(fund.address, target.mintAddress);
  if (held < amount) throw new ApiError(422, "UNPROCESSABLE", "Fund holds fewer tokens than the purchase being burned; reconcile first");
  const tokenAccount = associatedTokenAddress(fund.address, target.mintAddress, tokenProgram);
  const data = Buffer.alloc(10);
  data[0] = 15; // BurnChecked
  data.writeBigUInt64LE(amount, 1);
  data[9] = target.decimals;
  const ix = {
    programId: tokenProgram,
    accounts: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: target.mintAddress, isSigner: false, isWritable: true },
      { pubkey: fund.address, isSigner: true, isWritable: false },
    ],
    data,
  };
  assertBurnAllowed(ix, { fundWallet: fund.address, targetMint: target.mintAddress, tokenAccount, amount, decimals: target.decimals });
  return { request: req, amount, instruction: { ...ix, data: data.toString("base64") } };
}

export async function recordBurnSubmission(id: string, signature: string, actor: Actor, lastValidBlockHeight?: bigint) {
  return prisma.$transaction(async (db) => {
    if (await db.chainTransaction.findUnique({ where: { signature } })) throw new ApiError(409, "CONFLICT", "This signature is already recorded");
    await transition(db, id, ["SWAP_CONFIRMED"], { status: "BURN_SUBMITTED", burnSignature: signature, burnAttempts: { increment: 1 } });
    await db.chainTransaction.create({ data: { signature, purpose: "BURN", requestId: id, lastValidBlockHeight } });
    await recordAudit(db, actor, "buyback.burn_submitted", "Buyback", id, null, { signature });
    return getRequest(id, db);
  });
}

/** Sums verified burns of `mint` by `authority` in a transaction (top-level and inner instructions). */
export function burnedIn(tx: ChainTx, p: { mint: string; authority: string }): bigint {
  if (tx.err) return 0n;
  let total = 0n;
  for (const ix of tx.instructions) {
    if (ix.programId !== PROGRAMS.TOKEN && ix.programId !== PROGRAMS.TOKEN_2022) continue;
    if (!ix.parsed || (ix.parsed.type !== "burn" && ix.parsed.type !== "burnChecked")) continue;
    const info = ix.parsed.info as { mint?: string; authority?: string; multisigAuthority?: string; amount?: string; tokenAmount?: { amount?: string } };
    if (info.mint !== p.mint || (info.authority ?? info.multisigAuthority) !== p.authority) continue;
    const raw = info.tokenAmount?.amount ?? info.amount;
    if (typeof raw === "string" && /^\d+$/.test(raw)) total += BigInt(raw);
  }
  return total;
}

export async function settleBurn(id: string) {
  const req = await getRequest(id);
  if (req.status !== "BURN_SUBMITTED" || !req.burnSignature) return req;
  const { chain, now } = getDemolitionDeps();
  const fund = await requireFundWallet();
  const sig = req.burnSignature;
  const tx = await chain.getTransaction(sig);
  const record = await prisma.chainTransaction.findUnique({ where: { signature: sig } });

  const backToConfirmed = (status: "FAILED" | "EXPIRED", reason: string, slot?: bigint) =>
    prisma.$transaction(async (db) => {
      await db.chainTransaction.update({ where: { signature: sig }, data: { status, error: reason, slot, resolvedAt: now() } });
      // Tokens stay accounted for on the request; only the burn is retried.
      await transition(db, id, ["BURN_SUBMITTED"], { status: "SWAP_CONFIRMED", failureReason: `Burn ${status.toLowerCase()}: ${reason}` });
      await recordFailure(db, `burn: ${reason}`);
      await recordAudit(db, SYSTEM_ACTOR, "buyback.burn_failed", "Buyback", id, null, { signature: sig, reason });
      return getRequest(id, db);
    });

  if (!tx) {
    const state = await chain.getSignatureState(sig);
    if (await submissionDead(record, state.status !== null)) return backToConfirmed("EXPIRED", "Burn transaction expired");
    return req;
  }
  if (tx.err) return backToConfirmed("FAILED", "Burn transaction failed on-chain", tx.slot);

  const burned = burnedIn(tx, { mint: req.targetMint, authority: fund.address });
  const balanceDrop = -tokenDelta(tx, fund.address, req.targetMint);
  const outstanding = (req.tokensReceivedRaw ?? 0n) - req.tokensBurnedRaw;
  if (burned <= 0n || balanceDrop !== burned || burned > outstanding) {
    const reason = burned <= 0n ? "No matching burn instruction" : burned > outstanding ? "Burn exceeds purchased tokens" : "Burn amount does not match the balance change";
    return backToConfirmed("FAILED", reason, tx.slot);
  }
  return prisma.$transaction(async (db) => {
    await db.chainTransaction.update({ where: { signature: sig }, data: { status: "FINALIZED", slot: tx.slot, amount: burned, resolvedAt: now() } });
    const total = req.tokensBurnedRaw + burned;
    const done = total === req.tokensReceivedRaw;
    await transition(db, id, ["BURN_SUBMITTED"], {
      status: done ? "BURNED" : "SWAP_CONFIRMED",
      tokensBurnedRaw: total,
      burnedAt: done ? now() : null,
      failureReason: null,
    });
    await recordSuccess(db);
    await recordAudit(db, SYSTEM_ACTOR, done ? "buyback.burned" : "buyback.partial_burn", "Buyback", id, null, { signature: sig, burned, total });
    return getRequest(id, db);
  });
}

/** Resolves every submitted swap and burn. Called by the worker; idempotent. */
export async function settleAll() {
  const open = await prisma.buybackRequest.findMany({ where: { status: { in: ["SWAP_SUBMITTED", "BURN_SUBMITTED"] } }, select: { id: true, status: true } });
  for (const r of open) {
    if (r.status === "SWAP_SUBMITTED") await settleSwap(r.id);
    else await settleBurn(r.id);
  }
  return open.length;
}
