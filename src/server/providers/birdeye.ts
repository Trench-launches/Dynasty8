import "server-only";
import { z } from "zod";
import type { Candle, ChartRange } from "@/contracts/api";
import { fetchJson, ProviderError, type FetchJsonOptions } from "@/server/http/fetch-json";
import { providerBudgets } from "@/server/http/rate-limit";
import { finiteNonNegative } from "@/server/sanitize";
import { isValidPublicKey } from "@/server/solana/address";
import type { ChartProvider } from "./types";

/**
 * Birdeye (data.birdeye.so/docs): API key required (header X-API-KEY), chain header x-chain.
 *   GET https://public-api.birdeye.so/defi/ohlcv?address&type&time_from&time_to&currency=usd
 *   type: 1m,3m,5m,15m,30m,1H,2H,4H,6H,8H,12H,1D,... max 1000 records.
 * Note: Birdeye marks /defi/ohlcv deprecated in favour of a v3 endpoint; switch once its
 * parameters are confirmed. Used only as a chart fallback when BIRDEYE_API_KEY is set.
 */
const RANGES: Record<ChartRange, { type: string; seconds: number; interval: string }> = {
  "1h": { type: "1m", seconds: 3_600, interval: "1m" },
  "24h": { type: "15m", seconds: 86_400, interval: "15m" },
  "7d": { type: "1H", seconds: 7 * 86_400, interval: "1h" },
  "30d": { type: "4H", seconds: 30 * 86_400, interval: "4h" },
  all: { type: "1D", seconds: 1000 * 86_400, interval: "1d" },
};

const bodySchema = z.object({
  success: z.boolean().optional(),
  data: z.object({ items: z.array(z.record(z.string(), z.unknown())).max(2000) }),
});

export function createBirdeyeProvider(
  apiKey: string,
  opts: Pick<FetchJsonOptions, "timeoutMs" | "fetchImpl" | "sleep">,
  now = () => Date.now(),
): ChartProvider {
  return {
    name: "birdeye",
    async getCandles({ mint, range }) {
      if (!isValidPublicKey(mint)) return null;
      if (!providerBudgets.birdeye.take("birdeye")) throw new ProviderError("Birdeye budget exhausted", "rate_limited");
      const spec = RANGES[range];
      const to = Math.floor(now() / 1000);
      const qs = new URLSearchParams({
        address: mint,
        type: spec.type,
        time_from: String(to - spec.seconds),
        time_to: String(to),
        currency: "usd",
      });
      const body = await fetchJson(`https://public-api.birdeye.so/defi/ohlcv?${qs}`, {
        ...opts,
        headers: { "X-API-KEY": apiKey, "x-chain": "solana" },
        retries: 1,
      });
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) throw new ProviderError("Unexpected Birdeye response", "invalid_response");
      const candles: Candle[] = [];
      for (const it of parsed.data.data.items) {
        const t = finiteNonNegative(it.unixTime);
        const [o, h, l, c] = [it.o, it.h, it.l, it.c].map(finiteNonNegative);
        if (t === null || o === null || h === null || l === null || c === null || h < l) continue;
        candles.push({ t, open: o, high: h, low: l, close: c, volumeUsd: finiteNonNegative(it.vUsd) });
      }
      candles.sort((a, b) => a.t - b.t);
      return candles.length ? { interval: spec.interval, candles } : null;
    },
  };
}
