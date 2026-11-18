import "server-only";
import type { TreasuryRole } from "@prisma/client";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "@/server/services/audit";
import { lamportDelta } from "./chain";
import { getDemolitionDeps } from "./deps";
import { getWallet, openCircuit, requireFundWallet, requireTargetToken } from "./fund";
import { sumBig } from "./money";

/**
 * Ledger figures derived only from verified records.
 * - allocated: per role, from RevenueAllocation (each tied to a verified receipt)
 * - spentOnBuybacks: SOL actually spent by confirmed swaps
 * - disbursed: verified SOL transfers to the ecosystem / operations wallets
 */
export async function ledgerTotals() {
  const [alloc, held, disb, spent, unburned] = await Promise.all([
    prisma.revenueAllocation.aggregate({ _sum: { buybackLamports: true, ecosystemLamports: true, operationsLamports: true } }),
    // Only shares the fund itself received (FUND_SPLITS) are owed onward; ON_CHAIN_SPLIT shares
    // were paid by Pump straight to the ecosystem / operations wallets.
    prisma.revenueAllocation.aggregate({ _sum: { ecosystemLamports: true, operationsLamports: true }, where: { paidDirect: false } }),
    prisma.disbursement.groupBy({ by: ["role"], _sum: { lamports: true } }),
    prisma.buybackRequest.aggregate({ _sum: { solSpentLamports: true }, where: { status: { in: ["SWAP_CONFIRMED", "BURN_SUBMITTED", "BURNED"] } } }),
    prisma.buybackRequest.findMany({ where: { status: { in: ["SWAP_CONFIRMED", "BURN_SUBMITTED"] } }, select: { tokensReceivedRaw: true, tokensBurnedRaw: true } }),
  ]);
  const disbursed = (role: TreasuryRole) => disb.find((d) => d.role === role)?._sum.lamports ?? 0n;
  const buyback = alloc._sum.buybackLamports ?? 0n;
  const ecosystem = alloc._sum.ecosystemLamports ?? 0n;
  const operations = alloc._sum.operationsLamports ?? 0n;
  const spentOnBuybacks = spent._sum.solSpentLamports ?? 0n;
  const ecosystemHeld = held._sum.ecosystemLamports ?? 0n;
  const operationsHeld = held._sum.operationsLamports ?? 0n;
  const ecosystemOwed = ecosystemHeld - disbursed("ECOSYSTEM");
  const operationsOwed = operationsHeld - disbursed("OPERATIONS");
  return {
    buybackAllocated: buyback,
    ecosystemAllocated: ecosystem,
    operationsAllocated: operations,
    /** Shares paid by Pump straight to the role wallets (ON_CHAIN_SPLIT). */
    ecosystemPaidDirect: ecosystem - ecosystemHeld,
    operationsPaidDirect: operations - operationsHeld,
    spentOnBuybacks,
    ecosystemDisbursed: disbursed("ECOSYSTEM"),
    operationsDisbursed: disbursed("OPERATIONS"),
    /** Ecosystem / operations money the fund still holds for onward transfer. */
    ecosystemOwed,
    operationsOwed,
    /** SOL the fund must still hold: unspent buyback money + shares still owed onward. */
    liabilities: buyback - spentOnBuybacks + ecosystemOwed + operationsOwed,
    /** Purchased tokens the fund must still hold until burned. */
    unburnedTokens: sumBig(unburned.map((r) => (r.tokensReceivedRaw ?? 0n) - r.tokensBurnedRaw)),
  };
}

/**
 * Compares the ledger with the chain. The fund must hold at least its liabilities in SOL
 * and at least the purchased-but-unburned tokens. A shortfall opens the circuit breaker.
 */
export async function reconcile(actor: Actor = SYSTEM_ACTOR) {
  const fund = await requireFundWallet();
  const { chain } = getDemolitionDeps();
  const totals = await ledgerTotals();
  const chainLamports = await chain.getBalance(fund.address);
  let chainTokenRaw = 0n;
  let tokenCheck = "native token not live";
  try {
    const target = await requireTargetToken();
    chainTokenRaw = await chain.getTokenBalance(fund.address, target.mintAddress);
    tokenCheck = chainTokenRaw >= totals.unburnedTokens ? "ok" : "token shortfall";
  } catch {
    /* no live native token: only SOL is reconciled */
  }
  const solOk = chainLamports >= totals.liabilities;
  const ok = solOk && tokenCheck !== "token shortfall";
  const note = ok ? null : [!solOk ? `SOL shortfall ${totals.liabilities - chainLamports}` : null, tokenCheck === "token shortfall" ? `token shortfall ${totals.unburnedTokens - chainTokenRaw}` : null].filter(Boolean).join("; ");
  return prisma.$transaction(async (db) => {
    const run = await db.reconciliationRun.create({
      data: { fundAddress: fund.address, chainLamports, liabilitiesLamports: totals.liabilities, chainTokenRaw, unburnedTokenRaw: totals.unburnedTokens, ok, note },
    });
    if (!ok) {
      await openCircuit(db, `Reconciliation failed: ${note}`);
      await recordAudit(db, actor, "fund.reconciliation_failed", "Fund", run.id, null, run);
    }
    return run;
  });
}

/** Records a verified SOL transfer from the fund to the ecosystem or operations wallet. */
export async function recordDisbursement(signature: string, role: "ECOSYSTEM" | "OPERATIONS", actor: Actor) {
  const fund = await requireFundWallet();
  const dest = await getWallet(role);
  if (!dest) throw new ApiError(422, "UNPROCESSABLE", `No ${role} wallet registered`);
  if (await prisma.disbursement.findUnique({ where: { signature } })) throw new ApiError(409, "CONFLICT", "Disbursement already recorded");
  const tx = await getDemolitionDeps().chain.getTransaction(signature);
  if (!tx) throw new ApiError(422, "UNPROCESSABLE", "Transaction not found or not finalized yet");
  if (tx.err) throw new ApiError(422, "UNPROCESSABLE", "Transaction failed on-chain");
  const received = lamportDelta(tx, dest.address);
  if (received <= 0n || lamportDelta(tx, fund.address) >= 0n) throw new ApiError(422, "UNPROCESSABLE", "No SOL moved from the fund to that wallet");
  const totals = await ledgerTotals();
  // Only money the fund itself holds for that role can be disbursed (never shares Pump already paid directly).
  const owed = role === "ECOSYSTEM" ? totals.ecosystemOwed : totals.operationsOwed;
  if (received > owed) throw new ApiError(422, "UNPROCESSABLE", `Transfer exceeds the ${role.toLowerCase()} allocation still held (${owed} lamports)`);
  return prisma.$transaction(async (db) => {
    if (await db.disbursement.findUnique({ where: { signature } })) throw new ApiError(409, "CONFLICT", "Disbursement already recorded");
    const d = await db.disbursement.create({ data: { signature, role, destination: dest.address, lamports: received, recordedById: actor.id } });
    await db.chainTransaction.create({ data: { signature, purpose: "DISBURSEMENT", status: "FINALIZED", slot: tx.slot, amount: received, resolvedAt: new Date() } });
    await recordAudit(db, actor, "fund.disbursement", "Fund", d.id, null, d);
    return d;
  });
}
