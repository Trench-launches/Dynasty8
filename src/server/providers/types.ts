import type { Candle, ChartRange } from "@/contracts/api";

/**
 * Provider adapter interfaces. Services depend only on these, so a provider can be
 * replaced (or a paid one added) without touching services, routes or the frontend.
 * Every field is nullable: adapters return only what the provider actually reports.
 */
export interface MarketQuote {
  source: string;
  priceUsd: number | null;
  priceSol: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  pairAddress: string | null;
  dexId: string | null;
  lastTradeAt: Date | null;
}

export interface MarketDataProvider {
  readonly name: string;
  /** Batch lookup. Mints with no data are simply absent from the map. */
  getQuotes(mints: string[]): Promise<Map<string, MarketQuote>>;
}

export interface CandleSeries {
  interval: string;
  candles: Candle[];
}

export interface ChartProvider {
  readonly name: string;
  /** Returns null when the provider has no history for this token / pool. */
  getCandles(input: { mint: string; poolAddress: string | null; range: ChartRange }): Promise<CandleSeries | null>;
}

export interface TokenMetadata {
  source: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  supply: string | null;
  decimals: number | null;
}

export interface TokenMetadataProvider {
  readonly name: string;
  getMetadata(mint: string): Promise<TokenMetadata | null>;
}
