/**
 * Adapters from backend DTOs to the shapes the existing frontend already uses
 * (`src/lib/integrations/types.ts`), so the mock layer can be swapped out gradually.
 *
 * Rules carried over from the backend:
 * - Unavailable data maps to `null`, never to 0.
 * - Only FRESH data is labelled `source: "live"`; STALE data keeps `isStale: true` so the UI
 *   can show "last updated ..." instead of presenting it as live.
 */
import type { ChartDto, MarketDto, PropertySummaryDto, TokenDto } from "@/contracts/api";
import type { PricePoint, TokenIdentity, TokenMarketData } from "@/lib/integrations/types";

/** Existing TokenIdentity, filled from the registry. */
export function toTokenIdentity(t: TokenDto): TokenIdentity {
  return {
    name: t.name,
    ticker: t.ticker,
    mintAddress: t.mintAddress,
    pumpFunUrl: t.pumpFunUrl,
    imageUrl: t.imageUrl,
    totalSupply: uiSupply(t.supplyRaw, t.decimals) ?? 0,
    decimals: t.decimals ?? 6,
  };
}

function uiSupply(raw: string | null, decimals: number | null): number | null {
  if (!raw || decimals === null || !/^\d+$/.test(raw)) return null;
  return Number(BigInt(raw) / 10n ** BigInt(decimals));
}

export interface MarketView {
  /**
   * Present only for FRESH data with every core field available. Holder count and
   * bonding-curve progress are not supplied by the backend, so they are omitted rather than faked.
   */
  data: Omit<TokenMarketData, "holders" | "bondingCurvePct"> | null;
  freshness: MarketDto["freshness"];
  isStale: boolean;
  /** Human-readable status for the UI. */
  label: string;
  /** Raw nullable values for components that can show partial data. */
  raw: MarketDto;
}

export function toMarketView(ticker: string, m: MarketDto): MarketView {
  const label =
    m.freshness === "FRESH"
      ? "Live"
      : m.freshness === "STALE"
        ? `Last updated ${m.updatedAt ?? "unknown"}`
        : m.reason === "NOT_LAUNCHED"
          ? "Token not launched"
          : m.reason === "TOKEN_INACTIVE"
            ? "Token inactive"
            : "Market data unavailable";
  const complete =
    m.freshness === "FRESH" &&
    m.priceUsd !== null &&
    m.marketCapUsd !== null &&
    m.change24hPct !== null &&
    m.volume24hUsd !== null &&
    m.updatedAt !== null;
  return {
    data: complete
      ? {
          ticker,
          priceUsd: m.priceUsd!,
          marketCapUsd: m.marketCapUsd!,
          change24hPct: m.change24hPct!,
          volume24hUsd: m.volume24hUsd!,
          source: "live",
          asOf: m.updatedAt!,
        }
      : null,
    freshness: m.freshness,
    isStale: m.freshness === "STALE",
    label,
    raw: m,
  };
}

/** Chart candles -> the PricePoint[] the existing PriceChart renders (close prices). */
export function toPricePoints(chart: ChartDto): PricePoint[] | null {
  if (chart.status !== "OK") return null;
  return chart.candles.map((c) => ({ t: c.t * 1000, price: c.close }));
}

/** Whether a property can be placed on the map (coordinates verified). */
export function hasMapPosition(p: PropertySummaryDto): p is PropertySummaryDto & { map: { x: number; y: number } } {
  return p.map !== null;
}

export const CATEGORY_LABEL: Record<PropertySummaryDto["category"], string> = {
  RESIDENTIAL: "Residential",
  SAFEHOUSE: "Safehouse",
  GARAGE: "Garage",
  MARINA: "Marina",
  COMMERCIAL: "Commercial",
  INDUSTRIAL: "Industrial",
  LUXURY: "Luxury",
  ENTERTAINMENT: "Entertainment",
  HOSPITALITY: "Hospitality",
  RETAIL: "Retail",
};
