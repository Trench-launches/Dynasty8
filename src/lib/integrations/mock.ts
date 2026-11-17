/**
 * Mock implementations of the integration interfaces. Swap these for real
 * providers in the next phase; components only import the interfaces' shapes.
 */
import { ECOSYSTEM_TOKEN, PROPERTIES, DEMO_SNAPSHOT_AT } from "@/data/properties";
import { seededRandom } from "@/lib/utils";
import type {
  ChartRange,
  MarketDataProvider,
  PricePoint,
  TokenMarketData,
  TradingProvider,
  WalletProvider,
} from "./types";

const RANGE_SPEC: Record<ChartRange, { points: number; stepMs: number }> = {
  "1H": { points: 60, stepMs: 60_000 },
  "24H": { points: 96, stepMs: 15 * 60_000 },
  "7D": { points: 84, stepMs: 2 * 3_600_000 },
  "30D": { points: 90, stepMs: 8 * 3_600_000 },
};

function findMarket(ticker: string): TokenMarketData | null {
  if (ticker === ECOSYSTEM_TOKEN.market.ticker) return ECOSYSTEM_TOKEN.market;
  return PROPERTIES.find((p) => p.market.ticker === ticker)?.market ?? null;
}

/**
 * Builds a deterministic demo series that ends at the demo price and, for the
 * 24H range, starts at the price implied by the demo 24h change. The shape is a
 * random walk bridged between those two endpoints.
 */
export function demoHistory(market: TokenMarketData, range: ChartRange): PricePoint[] {
  const { points, stepMs } = RANGE_SPEC[range];
  const rand = seededRandom(`${market.ticker}:${range}`);
  const end = market.priceUsd;
  const rangeDrift: Record<ChartRange, number> = {
    "1H": market.change24hPct / 24,
    "24H": market.change24hPct,
    "7D": market.change24hPct * 1.8 + 6,
    "30D": market.change24hPct * 2.5 + 18,
  };
  const start = end / (1 + rangeDrift[range] / 100);
  const vol = range === "1H" ? 0.006 : range === "24H" ? 0.018 : 0.03;

  const walk: number[] = [0];
  for (let i = 1; i < points; i++) {
    walk.push(walk[i - 1] + (rand() - 0.5) * 2 * vol);
  }
  const last = walk[points - 1];
  const endT = new Date(DEMO_SNAPSHOT_AT).getTime();
  return walk.map((w, i) => {
    const f = i / (points - 1);
    // Bridge: remove the walk's own drift, then interpolate log-price between endpoints.
    const bridged = w - last * f;
    const base = Math.log(start) + (Math.log(end) - Math.log(start)) * f;
    return { t: endT - (points - 1 - i) * stepMs, price: Math.exp(base + bridged) };
  });
}

export const mockMarketData: MarketDataProvider = {
  source: "demo",
  async getMarket(ticker) {
    return findMarket(ticker);
  },
  async getHistory(ticker, range) {
    const market = findMarket(ticker);
    return market ? demoHistory(market, range) : [];
  },
};

export const mockWallet: WalletProvider = {
  available: false,
  async connect() {
    throw new Error("Wallet connection is not available in this prototype.");
  },
  async disconnect() {},
};

export const trading: TradingProvider = {
  enabled: false,
  reason: "Trading through Pump.fun is coming soon. No token has been launched yet.",
};
