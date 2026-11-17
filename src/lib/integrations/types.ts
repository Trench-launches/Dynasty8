/**
 * Typed seams for the future Solana / Pump.fun integration.
 *
 * Nothing in this folder talks to a network today. The UI only depends on these
 * interfaces, so the mock implementations in `mock.ts` can be swapped for real
 * ones (RPC, Pump.fun market data, wallet adapter) without touching components.
 */

/** Where a number came from. The UI labels anything that is not "live". */
export type DataSource = "demo" | "live";

/** Market data for one SPL token. */
export interface TokenMarketData {
  ticker: string;
  priceUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  volume24hUsd: number;
  holders: number;
  /** Pump.fun bonding-curve completion, 0–100. Null once migrated. */
  bondingCurvePct: number | null;
  source: DataSource;
  /** ISO timestamp of the snapshot. */
  asOf: string;
}

/** Static token identity. Mint and market link stay null until the token exists. */
export interface TokenIdentity {
  name: string;
  ticker: string;
  /** Solana mint address. Null until deployed. */
  mintAddress: string | null;
  /** Pump.fun market URL. Null until launched. */
  pumpFunUrl: string | null;
  /** Token image URL. Null means the UI renders the generated emblem. */
  imageUrl: string | null;
  totalSupply: number;
  decimals: number;
}

export type ChartRange = "1H" | "24H" | "7D" | "30D";

export interface PricePoint {
  /** Unix ms */
  t: number;
  price: number;
}

/** Supplies prices and history. Mock today, Pump.fun / indexer later. */
export interface MarketDataProvider {
  readonly source: DataSource;
  getMarket(ticker: string): Promise<TokenMarketData | null>;
  getHistory(ticker: string, range: ChartRange): Promise<PricePoint[]>;
}

/** Wallet connection. Browsing never requires one. */
export interface WalletProvider {
  readonly available: boolean;
  connect(): Promise<{ publicKey: string }>;
  disconnect(): Promise<void>;
}

/** Trading is not enabled in this prototype. */
export interface TradingProvider {
  readonly enabled: false;
  readonly reason: string;
}
