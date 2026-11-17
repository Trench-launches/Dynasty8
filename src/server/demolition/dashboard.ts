import "server-only";
import type {
  FundBurnDto,
  FundEventDto,
  FundHistoryDto,
  FundSummaryDto,
  FundTransactionDto,
  PropertyContributionDto,
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
  const [cfg, fund, native, receipts, totals, pending, swaps, burns, contributing, lastRun] = await Promise.all([
    getFundConfig(),
    getWallet("FUND"),
    prisma.token.findFirst({ where: { isNative: true } }),
    prisma.feeReceipt.aggregate({ _sum: { lamports: true }, _count: true }),
    ledgerTotals(),
    pendingBuybackLamports(),
    prisma.buybackRequest.findMany({ where: { status: { in: [...CONFIRMED] } }, orderBy: { swapConfirmedAt: "desc" } }),
    prisma.chainTransaction.findMany({ where: { purpose: "BURN", status: "FINALIZED" }, orderBy: { resolvedAt: "desc" } }),
    prisma.feeReceipt.findMany({ distinct: ["tokenId"], select: { tokenId: true } }),
    prisma.reconciliationRun.findFirst({ orderBy: { createdAt: "desc" } }),
  ]);
  const latestSwap = swaps[0];
  const latestBurn = burns[0];
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
      creatorFeesLamports: s(receipts._sum.lamports),
      buybackAllocatedLamports: s(totals.buybackAllocated),
      ecosystemAllocatedLamports: s(totals.ecosystemAllocated),
      operationsAllocatedLamports: s(totals.operationsAllocated),
      pendingBuybackLamports: s(pending),
      solSpentOnBuybacksLamports: s(totals.spentOnBuybacks),
      dynastyPurchasedRaw: s(sumBig(swaps.map((r) => r.tokensReceivedRaw ?? 0n))),
      dynastyBurnedRaw: s(sumBig(burns.map((b) => b.amount ?? 0n))),
      successfulBuybacks: swaps.length,
      successfulBurns: burns.length,
      feeReceipts: receipts._count,
      contributingProperties: contributing.length,
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
  };
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
    fees.set(r.propertyId, (fees.get(r.propertyId) ?? 0n) + r.lamports);
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
