/**
 * Demolition Fund public API contract (pure types, safe for client components).
 *
 * Amounts are decimal strings in base units, because they can exceed JavaScript's safe
 * integer range: SOL amounts in lamports (9 decimals), token amounts in raw units (use the
 * `decimals` given). Every figure is derived from finalized, verified on-chain records;
 * nothing is estimated or simulated. A zero means "verified zero", not "unknown".
 */
export type Lamports = string;
export type RawAmount = string;

export interface FundSummaryDto {
  fundWallet: string | null;
  dynasty: { ticker: string; mint: string | null; decimals: number | null; live: boolean };
  allocation: { buybackBps: number; ecosystemBps: number; operationsBps: number };
  totals: {
    creatorFeesLamports: Lamports;
    buybackAllocatedLamports: Lamports;
    ecosystemAllocatedLamports: Lamports;
    operationsAllocatedLamports: Lamports;
    /** Verified buyback revenue not yet reserved by a buyback. */
    pendingBuybackLamports: Lamports;
    solSpentOnBuybacksLamports: Lamports;
    dynastyPurchasedRaw: RawAmount;
    dynastyBurnedRaw: RawAmount;
    successfulBuybacks: number;
    successfulBurns: number;
    feeReceipts: number;
    contributingProperties: number;
    /** $DYNASTY's own creator fees received by the fund (Option C: 100% buyback revenue). Included in creatorFeesLamports. */
    dynastyCreatorFeesLamports: string;
  };
  latestBuyback: { signature: string; solSpentLamports: Lamports; dynastyReceivedRaw: RawAmount; confirmedAt: string } | null;
  latestBurn: { signature: string; dynastyBurnedRaw: RawAmount; burnedAt: string } | null;
  status: { paused: boolean; circuitOpen: boolean; lastReconciliation: { ok: boolean; at: string } | null };
  /** Treasury transparency: balances observed on-chain and what the ledger says is owed. */
  treasury: FundTreasuryDto;
  /** Multisig proposals waiting for member action (prepared, created or approved). */
  pendingActions: FundPendingActionDto[];
  /** Most recent buybacks with their verification status. */
  buybacks: FundBuybackDto[];
  feeSharing: FundFeeSharingDto;
}

export type AllocationModeDto = "ON_CHAIN_SPLIT" | "FUND_SPLITS";

export interface FundTreasuryDto {
  /** ON_CHAIN_SPLIT: Pump pays fund / ecosystem / operations directly. FUND_SPLITS: the fund receives all and disburses. */
  allocationMode: AllocationModeDto;
  /** Fund SOL balance read on-chain at the last reconciliation (null before the first one). */
  fundBalanceLamports: Lamports | null;
  fundDynastyRaw: RawAmount | null;
  balanceObservedAt: string | null;
  /** SOL the fund keeps for fees and rent; never spent on buybacks. */
  reserveLamports: Lamports;
  /** Verified revenue the fund must still hold (unspent buyback money + shares owed onward). */
  liabilitiesLamports: Lamports;
  ecosystemOwedLamports: Lamports;
  operationsOwedLamports: Lamports;
  /** Shares Pump paid straight to the ecosystem / operations wallets (ON_CHAIN_SPLIT). */
  ecosystemPaidDirectLamports: Lamports;
  operationsPaidDirectLamports: Lamports;
  /** Purchased DYNASTY not yet burned (must still be in the fund). */
  unburnedDynastyRaw: RawAmount;
  wallets: { role: "FUND" | "ECOSYSTEM" | "OPERATIONS"; address: string; isMultisig: boolean; threshold: number | null; members: number | null; verifiedAt: string | null }[];
}

export interface FundPendingActionDto {
  buybackId: string;
  purpose: "SWAP" | "BURN";
  status: "PREPARED" | "CREATED" | "APPROVED";
  approvals: number;
  threshold: number;
  transactionIndex: string;
  proposalPda: string;
  /** SWAP: lamports to spend; BURN: raw DYNASTY to burn. */
  amount: string;
  createdAt: string;
}

export type BuybackVerification = "PLANNED" | "AWAITING_APPROVAL" | "AWAITING_EXECUTION" | "SWAP_PENDING" | "PURCHASE_VERIFIED" | "BURN_PENDING" | "BURN_VERIFIED" | "CANCELLED" | "FAILED";

export interface FundBuybackDto {
  id: string;
  createdAt: string;
  verification: BuybackVerification;
  budgetLamports: Lamports;
  solSpentLamports: Lamports | null;
  dynastyPurchasedRaw: RawAmount | null;
  dynastyBurnedRaw: RawAmount;
  swapSignature: string | null;
  burnSignature: string | null;
  confirmedAt: string | null;
  burnedAt: string | null;
}

export interface FundFeeSharingDto {
  /** Property tokens with a registered mint whose on-chain fee-sharing config was checked. */
  checked: number;
  matching: number;
  lastCheckedAt: string | null;
  issues: { ticker: string; mint: string; issues: string[] }[];
}

export type FundEventType = "FEE_RECEIPT" | "BUYBACK" | "BURN" | "DISBURSEMENT";

export interface FundEventDto {
  type: FundEventType;
  signature: string;
  at: string | null;
  /** Lamports for FEE_RECEIPT / BUYBACK (SOL spent) / DISBURSEMENT; raw DYNASTY for BURN. */
  amount: string;
  /** DYNASTY received, for BUYBACK only. */
  dynastyRaw: RawAmount | null;
  property: { slug: string; name: string; ticker: string } | null;
  explorerUrl: string;
}

export interface FundHistoryDto {
  items: FundEventDto[];
  /** Pass as `before` to get the next page; null when there is no more. */
  nextBefore: string | null;
}

export interface PropertyContributionDto {
  rank: number | null;
  property: { slug: string; name: string; ticker: string; mapPosition: { x: number; y: number } | null };
  mintAddress: string | null;
  creatorFeesLamports: Lamports;
  buybackAllocatedLamports: Lamports;
  /** DYNASTY burned with this property's revenue (pro rata across each funded buyback). */
  dynastyBurnedRaw: RawAmount;
  feeReceipts: number;
  lastReceiptAt: string | null;
}

export interface FundBurnDto {
  signature: string;
  dynastyBurnedRaw: RawAmount;
  burnedAt: string | null;
  buyback: { swapSignature: string | null; solSpentLamports: Lamports | null; dynastyReceivedRaw: RawAmount | null };
  explorerUrl: string;
}

export interface FundTransactionDto {
  signature: string;
  kind: "FEE_RECEIPT" | "SWAP" | "BURN" | "DISBURSEMENT";
  status: "SUBMITTED" | "FINALIZED" | "FAILED" | "EXPIRED";
  slot: string | null;
  amount: string | null;
  receipts: { mint: string; property: string | null; lamports: Lamports }[];
  explorerUrl: string;
}
