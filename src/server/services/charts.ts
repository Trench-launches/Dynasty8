import "server-only";
import type { ChartDto, ChartRange } from "@/contracts/api";
import { appCache } from "@/server/cache";
import { ProviderError } from "@/server/http/fetch-json";
import { logger } from "@/server/logger";
import { getProviders } from "@/server/providers/registry";
import { getPublishedPropertyRow } from "./properties";

/** Cache lifetimes per range; long ranges change slowly and providers are rate-limited. */
const TTL_MS: Record<ChartRange, number> = {
  "1h": 60_000,
  "24h": 5 * 60_000,
  "7d": 15 * 60_000,
  "30d": 60 * 60_000,
  all: 60 * 60_000,
};
/** Failures are cached briefly so a broken provider is not hammered. */
const FAILURE_TTL_MS = 60_000;

function unavailable(range: ChartRange, reason: ChartDto["reason"]): ChartDto {
  return { range, status: "UNAVAILABLE", reason, interval: null, source: null, candles: [], fetchedAt: new Date().toISOString() };
}

/**
 * Genuine provider history only. If no provider can supply it, the response says so;
 * candles are never interpolated or invented.
 */
export async function getChartForToken(
  token: { id: string; mintAddress: string | null; deploymentStatus: string },
  poolAddress: string | null,
  range: ChartRange,
): Promise<ChartDto> {
  if (!token.mintAddress || token.deploymentStatus !== "LIVE") return unavailable(range, "NOT_LAUNCHED");
  const mint = token.mintAddress;
  const key = `chart:${token.id}:${range}`;
  const cached = appCache.get<ChartDto>(key);
  if (cached) return cached;

  const { charts } = getProviders();
  let reason: ChartDto["reason"] = poolAddress ? "NO_HISTORY" : "NO_POOL";
  for (const provider of charts) {
    try {
      const series = await provider.getCandles({ mint, poolAddress, range });
      if (series && series.candles.length) {
        const dto: ChartDto = {
          range,
          status: "OK",
          reason: null,
          interval: series.interval,
          source: provider.name,
          candles: series.candles,
          fetchedAt: new Date().toISOString(),
        };
        appCache.set(key, dto, TTL_MS[range]);
        return dto;
      }
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : "unknown";
      logger.warn({ provider: provider.name, kind, range }, "chart provider failed");
      reason = kind === "rate_limited" ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE";
    }
  }
  if (charts.length === 0) reason = "PROVIDER_UNAVAILABLE";
  const dto = unavailable(range, reason);
  appCache.set(key, dto, FAILURE_TTL_MS);
  return dto;
}

export async function getPropertyChart(slug: string, range: ChartRange): Promise<ChartDto> {
  const row = await getPublishedPropertyRow(slug);
  if (!row.token) return unavailable(range, "NOT_LAUNCHED");
  return getChartForToken(row.token, row.token.snapshots[0]?.pairAddress ?? null, range);
}
