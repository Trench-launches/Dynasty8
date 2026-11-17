import "server-only";
import type { EcosystemDto, EcosystemMarketRowDto } from "@/contracts/api";
import { prisma } from "@/server/db";
import { getConfig } from "@/server/config";
import { toMarketDto, toTokenDto } from "./mappers";

export const ECOSYSTEM_DISCLAIMER =
  "REALTY is the ecosystem's native token. It does not own, control or back any property token, and property-token trading fees do not accrue to it. Property tokens are independent speculative assets and do not represent ownership of any real or in-game property.";

const latest = { snapshots: { orderBy: { fetchedAt: "desc" as const }, take: 1 } };

export async function getEcosystemMarkets(): Promise<EcosystemMarketRowDto[]> {
  const { MARKET_STALE_AFTER_MS } = getConfig();
  const now = Date.now();
  const tokens = await prisma.token.findMany({
    where: { isNative: false, deploymentStatus: "LIVE", mintAddress: { not: null }, property: { status: "PUBLISHED" } },
    include: { ...latest, property: true },
  });
  return tokens
    .filter((t) => t.property)
    .map((t) => ({
      property: { slug: t.property!.slug, name: t.property!.name, category: t.property!.category },
      token: toTokenDto(t),
      market: toMarketDto(t, now, MARKET_STALE_AFTER_MS),
    }))
    .sort((a, b) => (b.market.marketCapUsd ?? -1) - (a.market.marketCapUsd ?? -1));
}

export async function getEcosystem(): Promise<EcosystemDto> {
  const { MARKET_STALE_AFTER_MS } = getConfig();
  const now = Date.now();
  const [native, listedProperties, rows] = await Promise.all([
    prisma.token.findFirst({ where: { isNative: true }, include: latest }),
    prisma.property.count({ where: { status: "PUBLISHED" } }),
    getEcosystemMarkets(),
  ]);
  if (!native) throw new Error("Native token registry entry missing; run the seed");

  // Aggregates use FRESH data only, so stale numbers never inflate the totals.
  const fresh = rows.filter((r) => r.market.freshness === "FRESH");
  const sum = (k: "volume24hUsd" | "marketCapUsd") => {
    const vals = fresh.map((r) => r.market[k]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return {
    nativeToken: { ...toTokenDto(native), market: toMarketDto(native, now, MARKET_STALE_AFTER_MS) },
    totals: {
      listedProperties,
      launchedPropertyTokens: rows.length,
      aggregateVolume24hUsd: sum("volume24hUsd"),
      aggregateMarketCapUsd: sum("marketCapUsd"),
      tokensWithFreshData: fresh.length,
    },
    disclaimer: ECOSYSTEM_DISCLAIMER,
  };
}
