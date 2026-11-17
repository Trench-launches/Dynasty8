import "server-only";
import { z } from "zod";
import { fetchJson, ProviderError, type FetchJsonOptions } from "@/server/http/fetch-json";
import { providerBudgets } from "@/server/http/rate-limit";
import { finiteNonNegative, finiteNumber, sanitizeText } from "@/server/sanitize";
import { isValidPublicKey, PROGRAMS } from "@/server/solana/address";
import type { MarketDataProvider, MarketQuote } from "./types";

/**
 * DexScreener (docs.dexscreener.com/api/reference):
 *   GET https://api.dexscreener.com/tokens/v1/solana/{addr1,addr2,...}  (up to 30, 300 req/min, no key)
 * Pair fields used: chainId, dexId, pairAddress, baseToken, quoteToken, priceUsd, priceNative,
 * marketCap, fdv, volume.h24, priceChange.h24, liquidity.usd.
 * DexScreener has no REST price-history endpoint, so it is not used for charts.
 */
const BATCH = 30;
const MAX_REASONABLE_USD = 1e13;

const pairSchema = z
  .object({
    chainId: z.string(),
    dexId: z.string().optional(),
    pairAddress: z.string(),
    baseToken: z.object({ address: z.string() }).passthrough(),
    quoteToken: z.object({ address: z.string() }).passthrough(),
    priceUsd: z.union([z.string(), z.number()]).nullish(),
    priceNative: z.union([z.string(), z.number()]).nullish(),
    marketCap: z.number().nullish(),
    fdv: z.number().nullish(),
    volume: z.record(z.string(), z.unknown()).nullish(),
    priceChange: z.record(z.string(), z.unknown()).nullish(),
    liquidity: z.object({ usd: z.number().nullish() }).passthrough().nullish(),
  })
  .passthrough();

const capped = (v: unknown) => {
  const n = finiteNonNegative(v);
  return n !== null && n <= MAX_REASONABLE_USD ? n : null;
};

export function quoteFromPair(mint: string, raw: unknown): MarketQuote | null {
  const parsed = pairSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  // Only pairs where our exact mint is the base token. Same-ticker impostors never match.
  if (p.chainId !== "solana" || p.baseToken.address !== mint) return null;
  if (!isValidPublicKey(p.pairAddress)) return null;
  const quoteIsSol = p.quoteToken.address === PROGRAMS.WRAPPED_SOL;
  const change = finiteNumber(p.priceChange?.h24);
  return {
    source: "dexscreener",
    priceUsd: capped(p.priceUsd),
    priceSol: quoteIsSol ? capped(p.priceNative) : null,
    marketCapUsd: capped(p.marketCap),
    fdvUsd: capped(p.fdv),
    volume24hUsd: capped(p.volume?.h24),
    change24hPct: change !== null && Math.abs(change) < 1e7 ? change : null,
    liquidityUsd: capped(p.liquidity?.usd),
    pairAddress: p.pairAddress,
    dexId: sanitizeText(p.dexId, 40),
    // DexScreener does not report a last-trade time on this endpoint.
    lastTradeAt: null,
  };
}

export function createDexScreenerProvider(opts: Pick<FetchJsonOptions, "timeoutMs" | "fetchImpl" | "sleep">): MarketDataProvider {
  return {
    name: "dexscreener",
    async getQuotes(mints) {
      const out = new Map<string, MarketQuote>();
      const valid = [...new Set(mints.filter(isValidPublicKey))];
      for (let i = 0; i < valid.length; i += BATCH) {
        const batch = valid.slice(i, i + BATCH);
        if (!providerBudgets.dexscreener.take("dexscreener")) {
          throw new ProviderError("DexScreener budget exhausted", "rate_limited");
        }
        const body = await fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`, opts);
        if (!Array.isArray(body)) throw new ProviderError("Unexpected DexScreener response", "invalid_response");
        for (const mint of batch) {
          // Choose the most liquid pair for this mint.
          let best: MarketQuote | null = null;
          for (const raw of body.slice(0, 500)) {
            const q = quoteFromPair(mint, raw);
            if (q && (best === null || (q.liquidityUsd ?? -1) > (best.liquidityUsd ?? -1))) best = q;
          }
          if (best) out.set(mint, best);
        }
      }
      return out;
    },
  };
}
