import type { MarketSnapshot, Property, SourceReference, Token } from "@prisma/client";
import type { MarketDto, PropertyDetailDto, PropertySummaryDto, TokenDto } from "@/contracts/api";
import { launchOrder } from "@/data/catalogue";

export type TokenWithSnapshot = Token & { snapshots: MarketSnapshot[] };
export type PropertyRow = Property & { token: TokenWithSnapshot | null; sources?: SourceReference[] };

export function toTokenDto(t: Token): TokenDto {
  return {
    id: t.id,
    mintAddress: t.mintAddress,
    name: t.name,
    ticker: t.ticker,
    imageUrl: t.imageUrl,
    // Never expose a trading link for a token that is not verified and live.
    pumpFunUrl: t.deploymentStatus === "LIVE" && t.mintAddress ? t.pumpFunUrl : null,
    deploymentStatus: t.deploymentStatus,
    launchedAt: t.launchedAt?.toISOString() ?? null,
    creatorWallet: t.creatorVerified ? t.creatorWallet : null,
    isNative: t.isNative,
    metadataStatus: t.metadataStatus,
    venue: t.venue,
    decimals: t.decimals,
    supplyRaw: t.onchainSupply,
  };
}

const EMPTY = {
  source: null,
  priceUsd: null,
  priceSol: null,
  marketCapUsd: null,
  fdvUsd: null,
  volume24hUsd: null,
  change24hPct: null,
  liquidityUsd: null,
  lastTradeAt: null,
  updatedAt: null,
} as const;

/**
 * Builds the market view for a token. No snapshot -> UNAVAILABLE. Old snapshot -> STALE
 * (values kept but flagged). Tokens that are not LIVE never show market data.
 */
export function toMarketDto(token: TokenWithSnapshot | null, now: number, staleAfterMs: number): MarketDto {
  if (!token || !token.mintAddress || token.deploymentStatus === "NOT_LAUNCHED" || token.deploymentStatus === "PENDING_VERIFICATION") {
    return { freshness: "UNAVAILABLE", reason: "NOT_LAUNCHED", ...EMPTY };
  }
  if (token.deploymentStatus === "INACTIVE") {
    return { freshness: "UNAVAILABLE", reason: "TOKEN_INACTIVE", ...EMPTY };
  }
  const s = token.snapshots[0];
  if (!s) return { freshness: "UNAVAILABLE", reason: "NO_DATA_YET", ...EMPTY };
  return {
    freshness: now - s.fetchedAt.getTime() > staleAfterMs ? "STALE" : "FRESH",
    reason: null,
    source: s.source,
    priceUsd: s.priceUsd,
    priceSol: s.priceSol,
    marketCapUsd: s.marketCapUsd,
    fdvUsd: s.fdvUsd,
    volume24hUsd: s.volume24hUsd,
    change24hPct: s.change24hPct,
    liquidityUsd: s.liquidityUsd,
    lastTradeAt: s.lastTradeAt?.toISOString() ?? null,
    updatedAt: s.fetchedAt.toISOString(),
  };
}

export function toPropertySummary(p: PropertyRow, now: number, staleAfterMs: number): PropertySummaryDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    typeLabel: p.typeLabel,
    region: p.region,
    neighbourhood: p.neighbourhood,
    map: p.mapX !== null && p.mapY !== null ? { x: p.mapX, y: p.mapY } : null,
    imageUrl: p.imageUrl,
    locationVerification: p.locationVerification,
    featured: p.featured,
    proposedTicker: p.proposedTicker,
    description: p.description,
    launchOrder: launchOrder(p.slug),
    token: p.token ? toTokenDto(p.token) : null,
    market: toMarketDto(p.token, now, staleAfterMs),
  };
}

export function toPropertyDetail(p: PropertyRow, now: number, staleAfterMs: number): PropertyDetailDto {
  return {
    ...toPropertySummary(p, now, staleAfterMs),
    galleryImages: p.galleryImages,
    sources: (p.sources ?? []).map((s) => ({ url: s.url, title: s.title, note: s.note })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
