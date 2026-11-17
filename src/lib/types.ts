/**
 * Shared data contracts for the Dynasty 8 frontend.
 *
 * These mirror the expected backend responses:
 *   GET /api/properties               -> Property[]
 *   GET /api/properties/:slug         -> Property
 *   GET /api/properties/:slug/market  -> MarketSnapshot | null
 *   GET /api/properties/:slug/chart   -> ChartPoint[]
 *   GET /api/ecosystem                -> EcosystemToken
 *   GET /api/ecosystem/markets        -> EcosystemMarkets
 *
 * Keep this file as the single source of truth for shapes. If the backend
 * changes a field, change it here first and let TypeScript find the call sites.
 */

export type RegionId =
  | "port-gellhorn"
  | "ambrosia"
  | "mount-kalaga"
  | "vice-city"
  | "grassrivers"
  | "leonida-keys";

export type PropertyCategory =
  | "motel"
  | "safehouse"
  | "apartment"
  | "house"
  | "garage"
  | "marina"
  | "hotel"
  | "luxury"
  | "offices"
  | "studio"
  | "automotive"
  | "nightlife";

/** Lifecycle of the property's Pump.fun token. */
export type TokenStatus = "coming_soon" | "live" | "unavailable";

/**
 * Whether the property itself has been confirmed as a real GTA VI location.
 * Most listings are proposals until the team confirms them.
 */
export type VerificationStatus = "confirmed" | "reported" | "unverified";

/**
 * A position on the Dynasty 8 map, in map-world units (see MAP_WIDTH / MAP_HEIGHT;
 * x grows east, y grows south).
 * `precision: "approximate"` means district-level placement, not an exact plot.
 * A property with `location: null` has no agreed placement yet and only appears in the sidebar.
 */
export interface MapLocation {
  x: number;
  y: number;
  precision: "exact" | "approximate";
}

export interface PropertyToken {
  /** Ticker without the leading $, e.g. "STARLET". null until the team assigns one. */
  ticker: string | null;
  status: TokenStatus;
  /** Solana mint address. Only shown when `mintVerified` is true. */
  mint: string | null;
  mintVerified: boolean;
  /** Pump.fun trading URL. Only linked when `mintVerified` is true. */
  pumpFunUrl: string | null;
  launchedAt: string | null;
}

/**
 * Market figures for a token. `source` must be "live" for real data.
 * "demo" values are generated for design work and are always labelled as such in the UI.
 */
export interface MarketSnapshot {
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  change24hPct: number;
  holders: number | null;
  updatedAt: string;
  source: "live" | "demo";
}

export interface Property {
  id: string;
  slug: string;
  name: string;
  neighbourhood: string;
  region: RegionId;
  category: PropertyCategory;
  description: string;
  /** Remote image URL. null renders the generated illustration instead. */
  image: string | null;
  featured: boolean;
  /** Launch-batch order (1 = first). null for listings outside the launch batch. */
  priority: number | null;
  verification: {
    status: VerificationStatus;
    note: string | null;
  };
  location: MapLocation | null;
  token: PropertyToken;
  market: MarketSnapshot | null;
}

export interface ChartPoint {
  /** ISO timestamp */
  t: string;
  priceUsd: number;
  volumeUsd: number;
}

export type ChartRange = "24h" | "7d" | "30d";

export interface EcosystemToken {
  name: string;
  ticker: string;
  status: TokenStatus;
  mint: string | null;
  mintVerified: boolean;
  pumpFunUrl: string | null;
  summary: string;
  market: MarketSnapshot | null;
}

export interface EcosystemMarkets {
  liveTokens: number;
  totalListings: number;
  totalMarketCapUsd: number | null;
  totalVolume24hUsd: number | null;
  source: "live" | "demo" | null;
}

export interface Region {
  id: RegionId;
  name: string;
  /** Label anchor on the map, world units */
  label: { x: number; y: number };
}
