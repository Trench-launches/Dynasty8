/**
 * View models used by the Dynasty 8 UI components.
 *
 * The backend's wire format lives in src/contracts/api.ts. src/lib/api-client/adapter.ts
 * converts those DTOs into these shapes, and the mock (src/lib/mock-api.ts) produces them
 * directly. If the backend changes a field, update the adapter; components only see these.
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
  | "nightlife"
  | "retail"
  | "industrial";

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
 * A metric is null when no provider supplied it (never shown as zero).
 * `stale` is true when the backend's last snapshot is older than its freshness window:
 * show the numbers with their age, never as live.
 */
export interface MarketSnapshot {
  priceUsd: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  holders: number | null;
  updatedAt: string;
  source: "live" | "demo";
  stale: boolean;
}

export interface Property {
  id: string;
  slug: string;
  name: string;
  neighbourhood: string;
  /** null until a region is entered for the listing. */
  region: RegionId | null;
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
  volumeUsd: number | null;
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
