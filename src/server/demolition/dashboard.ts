import "server-only";
import type {
  FundBurnDto,
  FundEventDto,
  FundHistoryDto,
  FundSummaryDto,
  FundTransactionDto,
  PropertyContributionDto,
  BuybackVerification,
} from "@/contracts/demolition-fund";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { getFundConfig, getWallet } from "./fund";
import { pendingBuybackLamports } from "./buyback";
import { ledgerTotals } from "./reconcile";
import { sumBig } from "./money";

const explorer = (sig: string) => `https://solscan.io/tx/${sig}`;
const s = (n: bigint | null | undefined) => (n ?? 0n).toString();
const CONFIRMED = ["SWAP_CONFIRMED", "BURN_SUBMITTED", "BURNED"] as const;

export async function getFundSummary(): Promise<FundSummaryDto> {
  const [cfg, fund, wallets, native, allocTotals, receiptCount, totals, pending, swaps, burns, contributing, lastRun, openProposals, recent, checks] = await Promise.all([
    getFundConfig(),
    getWallet("FUND"),
    prisma.treasuryWallet.findMany({ orderBy: { role: "asc" } }),
    prisma.token.findFirst({ where: { isNative: true } }),
    prisma.revenueAllocation.aggregate({ _sum: { buybackLamports: true, ecosystemLamports: true, operationsLamports: true } }),
    prisma.feeReceipt.count(),
    ledgerTotals(),
    pendingBuybackLamports(),
    prisma.buybackRequest.findMany({ where: { status: { in: [...CONFIRMED] } }, orderBy: { swapConfirmedAt: "desc" } }),
    prisma.chainTransaction.findMany({ where: { purpose: "BURN", status: "FINALIZED" }, orderBy: { resolvedAt: "desc" } }),
    prisma.feeReceipt.findMany({ where: { propertyId: { not: null } }, distinct: ["propertyId"], select: { propertyId: true } }),
    prisma.reconciliationRun.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.multisigProposal.findMany({ where: { status: { in: ["PREPARED", "CREATED", "APPROVED"] } }, orderBy: { createdAt: "asc" } }),
    prisma.buybackRequest.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { proposals: true } }),
    prisma.feeSharingCheck.findMany({ orderBy: { checkedAt: "desc" } }),
  ]);
  const latestSwap = swaps[0];
  const latestBurn = burns[0];
  // Creator fees credited to the ecosystem: the fund's share plus any shares Pump paid straight
  // to the ecosystem / operations wallets (ON_CHAIN_SPLIT).
  const creatorFees = (allocTotals._sum.buybackLamports ?? 0n) + (allocTotals._sum.ecosystemLamports ?? 0n) + (allocTotals._sum.operationsLamports ?? 0n);
  const tokenTickers = new Map((await prisma.token.findMany({ where: { id: { in: checks.map((c) => c.tokenId) } }, select: { id: true, ticker: true } })).map((t) => [t.id, t.ticker]));
  return {
    fundWallet: fund?.address ?? null,
    dynasty: {
      ticker: native?.ticker ?? "DYNASTY",
      mint: native?.deploymentStatus === "LIVE" ? native.mintAddress : null,
      decimals: native?.decimals ?? null,
      live: native?.deploymentStatus === "LIVE",
    },
    allocation: { buybackBps: cfg.buybackBps, ecosystemBps: cfg.ecosystemBps, operationsBps: cfg.operationsBps },
    totals: {
      creatorFeesLamports: s(creatorFees),
      buybackAllocatedLamports: s(totals.buybackAllocated),
      ecosystemAllocatedLamports: s(totals.ecosystemAllocated),
      operationsAllocatedLamports: s(totals.operationsAllocated),
      pendingBuybackLamports: s(pending),
      solSpentOnBuybacksLamports: s(totals.spentOnBuybacks),
      dynastyPurchasedRaw: s(sumBig(swaps.map((r) => r.tokensReceivedRaw ?? 0n))),
      dynastyBurnedRaw: s(sumBig(burns.map((b) => b.amount ?? 0n))),
      successfulBuybacks: swaps.length,
      successfulBurns: burns.length,
      feeReceipts: receiptCount,
      contributingProperties: contributing.length,
      dynastyCreatorFeesLamports: s(
        native ? ((await prisma.feeReceipt.aggregate({ where: { tokenId: native.id }, _sum: { lamports: true } }))._sum.lamports ?? 0n) : 0n,
      ),
    },
    latestBuyback:
      latestSwap?.swapSignature && latestSwap.swapConfirmedAt
        ? {
            signature: latestSwap.swapSignature,
            solSpentLamports: s(latestSwap.solSpentLamports),
            dynastyReceivedRaw: s(latestSwap.tokensReceivedRaw),
            confirmedAt: latestSwap.swapConfirmedAt.toISOString(),
          }
        : null,
    latestBurn: latestBurn
      ? { signature: latestBurn.signature, dynastyBurnedRaw: s(latestBurn.amount), burnedAt: (latestBurn.resolvedAt ?? latestBurn.submittedAt).toISOString() }
      : null,
    status: {
      paused: cfg.paused,
      circuitOpen: cfg.circuitOpen,
      lastReconciliation: lastRun ? { ok: lastRun.ok, at: lastRun.createdAt.toISOString() } : null,
    },
    treasury: {
      allocationMode: cfg.allocationMode,
      fundBalanceLamports: lastRun ? lastRun.chainLamports.toString() : null,
      fundDynastyRaw: lastRun ? lastRun.chainTokenRaw.toString() : null,
      balanceObservedAt: lastRun ? lastRun.createdAt.toISOString() : null,
      reserveLamports: s(cfg.reserveLamports),
      liabilitiesLamports: s(totals.liabilities),
      ecosystemOwedLamports: s(totals.ecosystemOwed),
      operationsOwedLamports: s(totals.operationsOwed),
      ecosystemPaidDirectLamports: s(totals.ecosystemPaidDirect),
      operationsPaidDirectLamports: s(totals.operationsPaidDirect),
      unburnedDynastyRaw: s(totals.unburnedTokens),
      wallets: wallets.map((w) => ({
        role: w.role,
        address: w.address,
        isMultisig: w.isMultisig,
        threshold: w.multisigThreshold,
        members: w.multisigMembers,
        verifiedAt: w.multisigVerifiedAt?.toISOString() ?? null,
      })),
    },
    pendingActions: openProposals.map((p) => ({
      buybackId: p.requestId,
      purpose: p.purpose as "SWAP" | "BURN",
      status: p.status as "PREPARED" | "CREATED" | "APPROVED",
      approvals: p.approvals,
      threshold: p.threshold,
      transactionIndex: p.transactionIndex.toString(),
      proposalPda: p.proposalPda,
      amount: p.amount.toString(),
      createdAt: p.createdAt.toISOString(),
    })),
    buybacks: recent.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      verification: buybackVerification(r.status, r.proposals),
      budgetLamports: s(r.budgetLamports),
      solSpentLamports: r.solSpentLamports !== null ? r.solSpentLamports.toString() : null,
      dynastyPurchasedRaw: r.tokensReceivedRaw !== null ? r.tokensReceivedRaw.toString() : null,
      dynastyBurnedRaw: s(r.tokensBurnedRaw),
      swapSignature: r.swapSignature,
      burnSignature: r.status === "BURNED" || r.tokensBurnedRaw > 0n ? r.burnSignature : null,
      confirmedAt: r.swapConfirmedAt?.toISOString() ?? null,
      burnedAt: r.burnedAt?.toISOString() ?? null,
    })),
    feeSharing: {
      checked: checks.length,
      matching: checks.filter((c) => c.matches).length,
      lastCheckedAt: checks[0]?.checkedAt.toISOString() ?? null,
      issues: checks.filter((c) => !c.matches).map((c) => ({ ticker: tokenTickers.get(c.tokenId) ?? "", mint: c.mint, issues: c.issues })),
    },
  };
}

function buybackVerification(status: string, proposals: { purpose: string; status: string }[]): BuybackVerification {
  const swapProposal = proposals.find((p) => p.purpose === "SWAP" && ["PREPARED", "CREATED", "APPROVED"].includes(p.status));
  switch (status) {
    case "PLANNED":
    case "QUOTED":
      return "PLANNED";
    case "APPROVED":
      return swapProposal ? (swapProposal.status === "APPROVED" ? "AWAITING_EXECUTION" : "AWAITING_APPROVAL") : "AWAITING_APPROVAL";
    case "SWAP_SUBMITTED":
      return "SWAP_PENDING";
    case "SWAP_CONFIRMED":
      return "PURCHASE_VERIFIED";
    case "BURN_SUBMITTED":
      return "BURN_PENDING";
    case "BURNED":
      return "BURN_VERIFIED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "FAILED";
  }
}

async function propertyIndex() {
  const props = await prisma.property.findMany({ include: { token: true } });
  return new Map(props.map((p) => [p.id, p]));
}

export async function getFundHistory(limit: number, before: Date | null): Promise<FundHistoryDto> {
  const time = before ? { lt: before } : undefined;
  const [receipts, swaps, burns, disbs, props] = await Promise.all([
    prisma.feeReceipt.findMany({ where: { createdAt: time }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.buybackRequest.findMany({ where: { status: { in: [...CONFIRMED] }, swapConfirmedAt: time ?? { not: null } }, orderBy: { swapConfirmedAt: "desc" }, take: limit }),
    prisma.chainTransaction.findMany({ where: { purpose: "BURN", status: "FINALIZED", resolvedAt: time ?? { not: null } }, orderBy: { resolvedAt: "desc" }, take: limit }),
    prisma.disbursement.findMany({ where: { verifiedAt: time }, orderBy: { verifiedAt: "desc" }, take: limit }),
    propertyIndex(),
  ]);
  const prop = (id: string | null) => {
    const p = id ? props.get(id) : undefined;
    return p ? { slug: p.slug, name: p.name, ticker: p.token?.ticker ?? p.proposedTicker } : null;
  };
  const events: (FundEventDto & { sortAt: Date })[] = [
    ...receipts.map((r) => ({ type: "FEE_RECEIPT" as const, signature: r.signature, sortAt: r.createdAt, at: (r.blockTime ?? r.createdAt).toISOString(), amount: s(r.lamports), dynastyRaw: null, property: prop(r.propertyId), explorerUrl: explorer(r.signature) })),
    ...swaps.map((r) => ({ type: "BUYBACK" as const, signature: r.swapSignature!, sortAt: r.swapConfirmedAt!, at: r.swapConfirmedAt!.toISOString(), amount: s(r.solSpentLamports), dynastyRaw: s(r.tokensReceivedRaw), property: null, explorerUrl: explorer(r.swapSignature!) })),
    ...burns.map((b) => ({ type: "BURN" as const, signature: b.signature, sortAt: b.resolvedAt!, at: b.resolvedAt!.toISOString(), amount: s(b.amount), dynastyRaw: null, property: null, explorerUrl: explorer(b.signature) })),
    ...disbs.map((d) => ({ type: "DISBURSEMENT" as const, signature: d.signature, sortAt: d.verifiedAt, at: d.verifiedAt.toISOString(), amount: s(d.lamports), dynastyRaw: null, property: null, explorerUrl: explorer(d.signature) })),
  ].sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
  const page = events.slice(0, limit);
  return {
    items: page.map((e) => {
      const { sortAt, ...rest } = e;
      void sortAt;
      return rest;
    }),
    nextBefore: events.length > limit || page.length === limit ? page[page.length - 1]!.sortAt.toISOString() : null,
  };
}

/** Leaderboard of property tokens by verified revenue contributed to the fund. */
export async function getPropertyContributions(): Promise<PropertyContributionDto[]> {
  const [props, receipts, burnedRequests] = await Promise.all([
    prisma.property.findMany({ where: { status: "PUBLISHED" }, include: { token: true } }),
    prisma.feeReceipt.findMany({ include: { allocation: true } }),
    prisma.buybackRequest.findMany({
      where: { tokensBurnedRaw: { gt: 0 } },
      include: { fundings: { include: { allocation: { include: { receipt: true } } } } },
    }),
  ]);
  const fees = new Map<string, bigint>();
  const buyback = new Map<string, bigint>();
  const count = new Map<string, number>();
  const last = new Map<string, Date>();
  for (const r of receipts) {
    if (!r.propertyId) continue;
    // Everything this property's fees credited to the ecosystem (fund share + any direct shares).
    const credited = r.allocation ? r.allocation.buybackLamports + r.allocation.ecosystemLamports + r.allocation.operationsLamports : r.lamports;
    fees.set(r.propertyId, (fees.get(r.propertyId) ?? 0n) + credited);
    buyback.set(r.propertyId, (buyback.get(r.propertyId) ?? 0n) + (r.allocation?.buybackLamports ?? 0n));
    count.set(r.propertyId, (count.get(r.propertyId) ?? 0) + 1);
    const at = r.blockTime ?? r.createdAt;
    if (!last.get(r.propertyId) || last.get(r.propertyId)! < at) last.set(r.propertyId, at);
  }
  // Burned DYNASTY attributed pro rata to the receipts that funded each buyback (integer floor).
  const burned = new Map<string, bigint>();
  for (const req of burnedRequests) {
    const total = sumBig(req.fundings.map((f) => f.lamports));
    if (total === 0n) continue;
    for (const f of req.fundings) {
      const pid = f.allocation.receipt.propertyId;
      if (!pid) continue;
      burned.set(pid, (burned.get(pid) ?? 0n) + (req.tokensBurnedRaw * f.lamports) / total);
    }
  }
  const rows = props.map((p) => ({
    rank: null as number | null,
    property: {
      slug: p.slug,
      name: p.name,
      ticker: p.token?.ticker ?? p.proposedTicker,
      mapPosition: p.mapX !== null && p.mapY !== null ? { x: p.mapX, y: p.mapY } : null,
    },
    mintAddress: p.token?.deploymentStatus === "LIVE" ? p.token.mintAddress : null,
    fees: fees.get(p.id) ?? 0n,
    creatorFeesLamports: s(fees.get(p.id)),
    buybackAllocatedLamports: s(buyback.get(p.id)),
    dynastyBurnedRaw: s(burned.get(p.id)),
    feeReceipts: count.get(p.id) ?? 0,
    lastReceiptAt: last.get(p.id)?.toISOString() ?? null,
  }));
  rows.sort((a, b) => (b.fees > a.fees ? 1 : b.fees < a.fees ? -1 : a.property.name.localeCompare(b.property.name)));
  let rank = 0;
  return rows.map(({ fees: f, ...r }) => ({ ...r, rank: f > 0n ? ++rank : null }));
}

export async function getFundBurns(limit: number): Promise<FundBurnDto[]> {
  const burns = await prisma.chainTransaction.findMany({ where: { purpose: "BURN", status: "FINALIZED" }, orderBy: { resolvedAt: "desc" }, take: limit, include: { request: true } });
  return burns.map((b) => ({
    signature: b.signature,
    dynastyBurnedRaw: s(b.amount),
    burnedAt: b.resolvedAt?.toISOString() ?? null,
    buyback: {
      swapSignature: b.request?.swapSignature ?? null,
      solSpentLamports: b.request?.solSpentLamports != null ? s(b.request.solSpentLamports) : null,
      dynastyReceivedRaw: b.request?.tokensReceivedRaw != null ? s(b.request.tokensReceivedRaw) : null,
    },
    explorerUrl: explorer(b.signature),
  }));
}

export async function getFundTransaction(signature: string): Promise<FundTransactionDto> {
  const [receipts, chainTx, props] = await Promise.all([
    prisma.feeReceipt.findMany({ where: { signature }, orderBy: { eventIndex: "asc" } }),
    prisma.chainTransaction.findUnique({ where: { signature } }),
    propertyIndex(),
  ]);
  if (!receipts.length && !chainTx) throw new ApiError(404, "NOT_FOUND", "Transaction not known to the Demolition Fund");
  const kind: FundTransactionDto["kind"] = chainTx ? (chainTx.purpose === "SWAP" ? "SWAP" : chainTx.purpose === "BURN" ? "BURN" : "DISBURSEMENT") : "FEE_RECEIPT";
  return {
    signature,
    kind,
    status: chainTx?.status ?? "FINALIZED",
    slot: chainTx?.slot != null ? chainTx.slot.toString() : receipts[0] ? receipts[0].slot.toString() : null,
    amount: chainTx ? (chainTx.amount != null ? chainTx.amount.toString() : null) : s(sumBig(receipts.map((r) => r.lamports))),
    receipts: receipts.map((r) => ({ mint: r.mint, property: r.propertyId ? props.get(r.propertyId)?.slug ?? null : null, lamports: s(r.lamports) })),
    explorerUrl: explorer(signature),
  };
}
