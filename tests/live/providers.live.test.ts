import { describe, expect, it } from "vitest";
import { createDexScreenerProvider } from "@/server/providers/dexscreener";
import { createGeckoTerminalProvider } from "@/server/providers/geckoterminal";
import { createHeliusProvider } from "@/server/providers/helius";
import { createBirdeyeProvider } from "@/server/providers/birdeye";
import { createSolanaReader } from "@/server/solana/rpc";
import { PROGRAMS } from "@/server/solana/address";

/**
 * Live smoke tests against real providers. Skipped unless LIVE_PROVIDER_TESTS=1.
 * Keyed providers additionally need HELIUS_API_KEY / BIRDEYE_API_KEY.
 * Uses Wrapped SOL (a well-known mint) so no project token is involved.
 */
const live = process.env.LIVE_PROVIDER_TESTS === "1";
const opts = { timeoutMs: 15_000 };

describe.skipIf(!live)("live providers", () => {
  let pool: string | null = null;

  it("DexScreener returns a quote for wSOL", async () => {
    const q = (await createDexScreenerProvider(opts).getQuotes([PROGRAMS.WRAPPED_SOL])).get(PROGRAMS.WRAPPED_SOL);
    expect(q).toBeDefined();
    expect(q!.priceUsd).toBeGreaterThan(0);
    pool = q!.pairAddress;
  });

  it("GeckoTerminal returns OHLCV for that pool", async () => {
    expect(pool).toBeTruthy();
    const s = await createGeckoTerminalProvider(opts).getCandles({ mint: PROGRAMS.WRAPPED_SOL, poolAddress: pool, range: "24h" });
    expect(s?.candles.length ?? 0).toBeGreaterThan(0);
  });

  it("Solana RPC reads the wSOL mint account", async () => {
    const m = await createSolanaReader(process.env.SOLANA_RPC_URL).getMintInfo(PROGRAMS.WRAPPED_SOL);
    expect(m).toMatchObject({ exists: true, program: "TOKEN", decimals: 9 });
    const curve = await createSolanaReader(process.env.SOLANA_RPC_URL).getPumpCurve(PROGRAMS.WRAPPED_SOL);
    expect(curve.exists).toBe(false);
  });

  it.skipIf(!process.env.HELIUS_API_KEY)("Helius getAsset returns metadata", async () => {
    const md = await createHeliusProvider(process.env.HELIUS_API_KEY!, opts).getMetadata(PROGRAMS.WRAPPED_SOL);
    expect(md?.decimals).toBe(9);
  });

  it.skipIf(!process.env.BIRDEYE_API_KEY)("Birdeye returns OHLCV", async () => {
    const s = await createBirdeyeProvider(process.env.BIRDEYE_API_KEY!, opts).getCandles({ mint: PROGRAMS.WRAPPED_SOL, poolAddress: null, range: "24h" });
    expect(s?.candles.length ?? 0).toBeGreaterThan(0);
  });
});
