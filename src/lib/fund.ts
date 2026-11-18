import "server-only";
import { connection } from "next/server";
import { usingMockApi } from "@/lib/api";
import { MOCK_PROPERTIES } from "@/data/properties";
import { NATIVE_TOKEN } from "@/data/catalogue";
import { getFundBurns, getFundHistory, getFundSummary, getPropertyContributions } from "@/server/demolition/dashboard";
import type { FundBurnDto, FundHistoryDto, FundSummaryDto, PropertyContributionDto } from "@/contracts/demolition-fund";

export interface FundPageData {
  summary: FundSummaryDto;
  contributions: PropertyContributionDto[];
  history: FundHistoryDto;
  burns: FundBurnDto[];
}

/** Activity rows on first load; the page loads more from /api/demolition-fund/history. */
export const FUND_HISTORY_PAGE = 20;

/**
 * Server-side reads for the Demolition Fund page, same pattern as src/lib/catalogue.ts:
 * per request (never at build time).
 */
export async function getFundPage(): Promise<FundPageData> {
  if (usingMockApi) return mockFund();
  await connection();
  return dbFund();
}

async function dbFund(): Promise<FundPageData> {
  const [summary, contributions, history, burns] = await Promise.all([
    getFundSummary(),
    getPropertyContributions(),
    getFundHistory(FUND_HISTORY_PAGE, null),
    getFundBurns(100),
  ]);
  return { summary, contributions, history, burns };
}

/**
 * Mock mode has no database, so it shows what a new fund looks like: the default 60/25/15
 * split, paused, nothing received. It never invents fund figures, even in demo-markets mode.
 */
function mockFund(): FundPageData {
  const zero = "0";
  return {
    summary: {
      fundWallet: null,
      dynasty: { ticker: NATIVE_TOKEN.ticker, mint: null, decimals: null, live: false },
      allocation: { buybackBps: 6000, ecosystemBps: 2500, operationsBps: 1500 },
      totals: {
        creatorFeesLamports: zero,
        buybackAllocatedLamports: zero,
        ecosystemAllocatedLamports: zero,
        operationsAllocatedLamports: zero,
        pendingBuybackLamports: zero,
        solSpentOnBuybacksLamports: zero,
        dynastyPurchasedRaw: zero,
        dynastyBurnedRaw: zero,
        successfulBuybacks: 0,
        successfulBurns: 0,
        feeReceipts: 0,
        contributingProperties: 0,
      },
      latestBuyback: null,
      latestBurn: null,
      status: { paused: true, circuitOpen: false, lastReconciliation: null },
      treasury: {
        allocationMode: "ON_CHAIN_SPLIT",
        fundBalanceLamports: null,
        fundDynastyRaw: null,
        balanceObservedAt: null,
        reserveLamports: "50000000",
        liabilitiesLamports: zero,
        ecosystemOwedLamports: zero,
        operationsOwedLamports: zero,
        ecosystemPaidDirectLamports: zero,
        operationsPaidDirectLamports: zero,
        unburnedDynastyRaw: zero,
        wallets: [],
      },
      pendingActions: [],
      buybacks: [],
      feeSharing: { checked: 0, matching: 0, lastCheckedAt: null, issues: [] },
    },
    contributions: [...MOCK_PROPERTIES]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        rank: null,
        property: {
          slug: p.slug,
          name: p.name,
          ticker: p.token.ticker ?? "",
          mapPosition: p.location ? { x: p.location.x, y: p.location.y } : null,
        },
        mintAddress: null,
        creatorFeesLamports: zero,
        buybackAllocatedLamports: zero,
        dynastyBurnedRaw: zero,
        feeReceipts: 0,
        lastReceiptAt: null,
      })),
    history: { items: [], nextBefore: null },
    burns: [],
  };
}
