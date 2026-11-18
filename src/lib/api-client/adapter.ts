/**
 * Backend DTOs (src/contracts/api.ts) -> the view models the UI renders (src/lib/types.ts).
 * Pure functions with type-only imports of the contract: safe on the server and in the browser.
 *
 * Rules carried over from the backend:
 * - Unavailable data maps to null, never to 0.
 * - Only LIVE tokens get a mint, a Pump.fun link or market numbers.
 * - STALE market data keeps its numbers but is flagged `stale`, so it is never shown as live.
 */
import type {
  ChartDto,
  EcosystemDto,
  LocationVerification,
  MarketDto,
  PropertyCategory as ApiCategory,
  PropertyDetailDto,
  PropertySummaryDto,
  TokenDto,
} from "@/contracts/api";
import { bundledPropertyImage } from "@/data/property-images";
import { REGIONS } from "@/data/regions";
import type {
  ChartPoint,
  ChartSeries,
  ChartUnavailableReason,
  EcosystemMarkets,
  EcosystemToken,
  MarketSnapshot,
  Property,
  PropertyCategory,
  PropertyToken,
  RegionId,
  TokenStatus,
  VerificationStatus,
} from "@/lib/types";

/** Display category from the free-text type label, e.g. "Apartments" -> "apartment". */
const CATEGORY_BY_TYPE_LABEL: Record<string, PropertyCategory> = {
  motel: "motel",
  safehouse: "safehouse",
  apartment: "apartment",
  apartments: "apartment",
  residential: "apartment",
  house: "house",
  garage: "garage",
  marina: "marina",
  hotel: "hotel",
  luxury: "luxury",
  mansion: "luxury",
  offices: "offices",
  office: "offices",
  studio: "studio",
  automotive: "automotive",
  motorsport: "automotive",
  nightlife: "nightlife",
  nightclub: "nightlife",
  bar: "nightlife",
  "rooftop bar": "nightlife",
  entertainment: "nightlife",
  retail: "retail",
  industrial: "industrial",
};

/** Fallback when the type label is missing or unknown. */
const CATEGORY_BY_ENUM: Record<ApiCategory, PropertyCategory> = {
  RESIDENTIAL: "apartment",
  SAFEHOUSE: "safehouse",
  GARAGE: "garage",
  MARINA: "marina",
  COMMERCIAL: "offices",
  INDUSTRIAL: "industrial",
  LUXURY: "luxury",
  ENTERTAINMENT: "nightlife",
  HOSPITALITY: "hotel",
  RETAIL: "retail",
};

export function toCategory(category: ApiCategory, typeLabel: string | null): PropertyCategory {
  const byLabel = typeLabel ? CATEGORY_BY_TYPE_LABEL[typeLabel.trim().toLowerCase()] : undefined;
  return byLabel ?? CATEGORY_BY_ENUM[category];
}

/** Accepts a region id ("vice-city") or its display name ("Vice City"). */
export function toRegionId(region: string | null): RegionId | null {
  if (!region) return null;
  const key = region.trim().toLowerCase();
  return REGIONS.find((r) => r.id === key || r.name.toLowerCase() === key)?.id ?? null;
}

export function toTokenStatus(token: Pick<TokenDto, "deploymentStatus"> | null): TokenStatus {
  switch (token?.deploymentStatus) {
    case "LIVE":
      return "live";
    case "INACTIVE":
      return "unavailable";
    default:
      // NOT_LAUNCHED, PENDING_VERIFICATION (an admin has not confirmed the mint yet), or no token row.
      return "coming_soon";
  }
}

const VERIFICATION: Record<LocationVerification, VerificationStatus> = {
  VERIFIED: "confirmed",
  REPORTED: "reported",
  CONCEPT: "unverified",
};

export function toMarketSnapshot(m: MarketDto): MarketSnapshot | null {
  if (m.freshness === "UNAVAILABLE" || !m.updatedAt) return null;
  return {
    priceUsd: m.priceUsd,
    marketCapUsd: m.marketCapUsd,
    volume24hUsd: m.volume24hUsd,
    change24hPct: m.change24hPct,
    holders: null, // no provider supplies holder counts
    updatedAt: m.updatedAt,
    source: "live",
    stale: m.freshness === "STALE",
  };
}

function toPropertyToken(t: TokenDto | null, proposedTicker: string): PropertyToken {
  const live = t?.deploymentStatus === "LIVE";
  return {
    ticker: t?.ticker ?? proposedTicker,
    status: toTokenStatus(t),
    // A mint only becomes LIVE after an admin verifies it on-chain.
    mint: live ? t!.mintAddress : null,
    mintVerified: live && t!.mintAddress !== null,
    pumpFunUrl: live ? t!.pumpFunUrl : null,
    launchedAt: t?.launchedAt ?? null,
  };
}

function neighbourhoodLabel(dto: PropertySummaryDto, region: RegionId | null): string {
  if (dto.neighbourhood) return dto.neighbourhood;
  return REGIONS.find((r) => r.id === region)?.name ?? "Location to be confirmed";
}

export function toProperty(dto: PropertySummaryDto | PropertyDetailDto): Property {
  const region = toRegionId(dto.region);
  const verification = VERIFICATION[dto.locationVerification];
  return {
    id: dto.id,
    slug: dto.slug,
    name: dto.name,
    neighbourhood: neighbourhoodLabel(dto, region),
    region,
    category: toCategory(dto.category, dto.typeLabel),
    description: dto.description,
    // An admin-entered photo wins; otherwise the original photo bundled with the site, if any.
    image: dto.imageUrl ?? bundledPropertyImage(dto.slug),
    featured: dto.featured,
    priority: dto.launchOrder,
    verification: {
      status: verification,
      note:
        verification === "unverified"
          ? "Proposed listing. Not yet verified as an official in-game location."
          : null,
    },
    location: dto.map
      ? { x: dto.map.x, y: dto.map.y, precision: verification === "confirmed" ? "exact" : "approximate" }
      : null,
    token: toPropertyToken(dto.token, dto.proposedTicker),
    market: toMarketSnapshot(dto.market),
  };
}

/** Candles -> close-price series, oldest first. Unavailable charts (not launched, no pool, rate limited...) are empty. */
export function toChartPoints(chart: ChartDto): ChartPoint[] {
  if (chart.status !== "OK") return [];
  return [...chart.candles]
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.close))
    .sort((a, b) => a.t - b.t)
    .map((c) => ({
      t: new Date(c.t * 1000).toISOString(),
      priceUsd: c.close,
      volumeUsd: c.volumeUsd,
    }));
}

const CHART_REASONS: Record<NonNullable<ChartDto["reason"]>, ChartUnavailableReason> = {
  NOT_LAUNCHED: "not_launched",
  NO_POOL: "no_pool",
  NO_HISTORY: "no_history",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  RATE_LIMITED: "rate_limited",
};

/** The chart plus why it is empty, so the UI can tell "not launched" from "provider down" from "no trades". */
export function toChartSeries(chart: ChartDto): ChartSeries {
  const ok = chart.status === "OK";
  return {
    points: toChartPoints(chart),
    unavailableReason: ok ? null : CHART_REASONS[chart.reason ?? "PROVIDER_UNAVAILABLE"],
    interval: ok ? chart.interval : null,
    source: ok ? chart.source : null,
    fetchedAt: chart.fetchedAt || null,
  };
}

export function toEcosystemToken(e: EcosystemDto): EcosystemToken {
  const t = e.nativeToken;
  const token = toPropertyToken(t, t.ticker);
  return {
    name: t.name,
    ticker: t.ticker,
    status: token.status,
    mint: token.mint,
    mintVerified: token.mintVerified,
    pumpFunUrl: token.pumpFunUrl,
    summary: e.disclaimer,
    market: toMarketSnapshot(t.market),
  };
}

export function toEcosystemMarkets(e: EcosystemDto): EcosystemMarkets {
  const { totals } = e;
  return {
    liveTokens: totals.launchedPropertyTokens,
    totalListings: totals.listedProperties,
    // Aggregates only include FRESH data, so they are live figures when present.
    totalMarketCapUsd: totals.aggregateMarketCapUsd,
    totalVolume24hUsd: totals.aggregateVolume24hUsd,
    source: totals.tokensWithFreshData > 0 ? "live" : null,
  };
}
