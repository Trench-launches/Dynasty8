/**
 * Public API contract shared by the backend and the frontend.
 * Pure types: safe to import from client components.
 *
 * Conventions
 * - `null` means "not available" (unknown / not supplied by any provider). It never means zero.
 * - Every market payload carries `freshness`; the UI must not present STALE or UNAVAILABLE data as live.
 * - Timestamps are ISO-8601 strings in UTC.
 */

export type PropertyCategory =
  | "RESIDENTIAL"
  | "SAFEHOUSE"
  | "GARAGE"
  | "MARINA"
  | "COMMERCIAL"
  | "INDUSTRIAL"
  | "LUXURY"
  | "ENTERTAINMENT"
  | "HOSPITALITY"
  | "RETAIL";

export type LocationVerification = "VERIFIED" | "REPORTED" | "CONCEPT";
export type TokenDeploymentStatus = "NOT_LAUNCHED" | "PENDING_VERIFICATION" | "LIVE" | "INACTIVE";
export type MetadataVerification = "UNVERIFIED" | "VERIFIED" | "MISMATCH";
export type TradingVenue = "UNKNOWN" | "PUMPFUN_BONDING_CURVE" | "PUMPSWAP" | "OTHER_DEX";
export type DataFreshness = "FRESH" | "STALE" | "UNAVAILABLE";

export interface SourceReferenceDto {
  url: string;
  title: string;
  note: string | null;
}

export interface TokenDto {
  id: string;
  /** Unique identity of a deployed token. Null until launched and verified. */
  mintAddress: string | null;
  name: string;
  ticker: string;
  imageUrl: string | null;
  /** Present only for a verified mint with an on-chain Pump.fun bonding curve. */
  pumpFunUrl: string | null;
  deploymentStatus: TokenDeploymentStatus;
  launchedAt: string | null;
  creatorWallet: string | null;
  isNative: boolean;
  metadataStatus: MetadataVerification;
  venue: TradingVenue;
  decimals: number | null;
  /** Raw on-chain supply in base units (string, may exceed 2^53). Null until verified. */
  supplyRaw: string | null;
}

export interface MarketDto {
  freshness: DataFreshness;
  /** Why data is unavailable, when it is. */
  reason: "NOT_LAUNCHED" | "TOKEN_INACTIVE" | "NO_DATA_YET" | null;
  source: string | null;
  priceUsd: number | null;
  priceSol: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  lastTradeAt: string | null;
  /** When the backend last fetched this snapshot. */
  updatedAt: string | null;
}

export interface PropertySummaryDto {
  id: string;
  slug: string;
  name: string;
  category: PropertyCategory;
  typeLabel: string | null;
  region: string | null;
  neighbourhood: string | null;
  /** Null until coordinates are verified; do not place such properties on the map. */
  map: { x: number; y: number } | null;
  imageUrl: string | null;
  locationVerification: LocationVerification;
  featured: boolean;
  /** Ticker proposed by the catalogue. Not proof of a deployed token. */
  proposedTicker: string;
  description: string;
  /** Position in the launch catalogue (1 = first); null for listings added later. */
  launchOrder: number | null;
  token: TokenDto | null;
  market: MarketDto;
}

export interface PropertyDetailDto extends PropertySummaryDto {
  galleryImages: string[];
  sources: SourceReferenceDto[];
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type ChartRange = "1h" | "24h" | "7d" | "30d" | "all";

export interface Candle {
  /** Bucket start, unix seconds. */
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume in USD when the provider reports it, else null. */
  volumeUsd: number | null;
}

export interface ChartDto {
  range: ChartRange;
  status: "OK" | "UNAVAILABLE";
  reason: "NOT_LAUNCHED" | "NO_POOL" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" | "NO_HISTORY" | null;
  /** e.g. "15m", "1h", "1d" */
  interval: string | null;
  source: string | null;
  candles: Candle[];
  fetchedAt: string;
}

export interface EcosystemDto {
  nativeToken: TokenDto & { market: MarketDto };
  totals: {
    listedProperties: number;
    launchedPropertyTokens: number;
    /** Sum over property tokens whose market data is FRESH. Null if none are. */
    aggregateVolume24hUsd: number | null;
    aggregateMarketCapUsd: number | null;
    /** How many tokens contributed to the aggregates. */
    tokensWithFreshData: number;
  };
  disclaimer: string;
}

export interface EcosystemMarketRowDto {
  property: { slug: string; name: string; category: PropertyCategory };
  token: TokenDto;
  market: MarketDto;
}

export interface HealthDto {
  status: "ok" | "degraded";
  time: string;
  database: "ok" | "error";
  providers: Record<string, "enabled" | "disabled">;
  marketData: { lastSnapshotAt: string | null; stale: boolean };
}

export interface ApiErrorDto {
  error: {
    code:
      | "BAD_REQUEST"
      | "NOT_FOUND"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "RATE_LIMITED"
      | "CONFLICT"
      | "UNPROCESSABLE"
      | "INTERNAL";
    message: string;
    details?: { path: string; message: string }[];
  };
}
