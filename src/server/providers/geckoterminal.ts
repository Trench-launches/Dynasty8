import "server-only";
import { z } from "zod";
import type { Candle, ChartRange } from "@/contracts/api";
import { fetchJson, ProviderError, type FetchJsonOptions } from "@/server/http/fetch-json";
import { providerBudgets } from "@/server/http/rate-limit";
import { finiteNonNegative } from "@/server/sanitize";
import { isValidPublicKey } from "@/server/solana/address";
import type { ChartProvider } from "./types";

/**
 * GeckoTerminal public API v2 (api.geckoterminal.com/docs/v2/swagger.json):
 *   GET /api/v2/networks/solana/pools/{pool}/ohlcv/{day|hour|minute}
 *       ?aggregate=..&limit<=1000&currency=usd&token=<mint>
 *   aggregate: day 1 | hour 1,4,12 | minute 1,5,15. ~10 calls/min free, cached 1 min upstream.
 *   ohlcv_list rows: [unix_seconds, open, high, low, close, volume].
 */
export const GECKO_RANGES: Record<ChartRange, { timeframe: "minute" | "hour" | "day"; aggregate: number; limit: number; interval: string }> = {
  "1h": { timeframe: "minute", aggregate: 1, limit: 60, interval: "1m" },
  "24h": { timeframe: "minute", aggregate: 15, limit: 96, interval: "15m" },
  "7d": { timeframe: "hour", aggregate: 1, limit: 168, interval: "1h" },
  "30d": { timeframe: "hour", aggregate: 4, limit: 180, interval: "4h" },
  all: { timeframe: "day", aggregate: 1, limit: 1000, interval: "1d" },
};

const bodySchema = z.object({
  data: z.object({
    attributes: z.object({ ohlcv_list: z.array(z.array(z.unknown())).max(2000) }),
  }),
});

export function parseOhlcvList(rows: unknown[][]): Candle[] {
  const out: Candle[] = [];
  for (const r of rows) {
    const [t, o, h, l, c, v] = r.map((x) => finiteNonNegative(x));
    if (t === null || o === null || h === null || l === null || c === null) continue;
    if (!Number.isInteger(t) || h < l || h < Math.max(o, c) || l > Math.min(o, c)) continue;
    out.push({ t, open: o, high: h, low: l, close: c, volumeUsd: v ?? null });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function createGeckoTerminalProvider(opts: Pick<FetchJsonOptions, "timeoutMs" | "fetchImpl" | "sleep">): ChartProvider {
  return {
    name: "geckoterminal",
    async getCandles({ mint, poolAddress, range }) {
      if (!poolAddress || !isValidPublicKey(poolAddress) || !isValidPublicKey(mint)) return null;
      if (!providerBudgets.geckoterminal.take("geckoterminal")) {
        throw new ProviderError("GeckoTerminal budget exhausted", "rate_limited");
      }
      const spec = GECKO_RANGES[range];
      const qs = new URLSearchParams({
        aggregate: String(spec.aggregate),
        limit: String(spec.limit),
        currency: "usd",
        token: mint,
      });
      const body = await fetchJson(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${spec.timeframe}?${qs}`,
        { ...opts, headers: { accept: "application/json;version=20230203" }, retries: 1 },
      );
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) throw new ProviderError("Unexpected GeckoTerminal response", "invalid_response");
      const candles = parseOhlcvList(parsed.data.data.attributes.ohlcv_list);
      return candles.length ? { interval: spec.interval, candles } : null;
    },
  };
}
