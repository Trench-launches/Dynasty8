import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createDexScreenerProvider, quoteFromPair } from "@/server/providers/dexscreener";
import { createGeckoTerminalProvider, parseOhlcvList } from "@/server/providers/geckoterminal";
import { parseHeliusAsset } from "@/server/providers/helius";
import { providerBudgets } from "@/server/http/rate-limit";
import { PROGRAMS } from "@/server/solana/address";

const key = () => Keypair.generate().publicKey.toBase58();

function pair(mint: string, over: Record<string, unknown> = {}) {
  return {
    chainId: "solana",
    dexId: "pumpswap",
    pairAddress: key(),
    baseToken: { address: mint, name: "Starlet", symbol: "STARLET" },
    quoteToken: { address: PROGRAMS.WRAPPED_SOL, symbol: "SOL" },
    priceNative: "0.0000031",
    priceUsd: "0.000412",
    volume: { h24: 88400.5 },
    priceChange: { h24: -4.2 },
    liquidity: { usd: 25000 },
    fdv: 412000,
    marketCap: 412000,
    ...over,
  };
}

describe("DexScreener adapter", () => {
  it("maps documented fields, converting numeric strings", () => {
    const mint = key();
    const q = quoteFromPair(mint, pair(mint))!;
    expect(q).toMatchObject({ priceUsd: 0.000412, priceSol: 0.0000031, marketCapUsd: 412000, volume24hUsd: 88400.5, change24hPct: -4.2, liquidityUsd: 25000, dexId: "pumpswap" });
    expect(q.lastTradeAt).toBeNull();
  });

  it("ignores impostor pairs whose base token is a different mint (same ticker)", () => {
    const mint = key();
    expect(quoteFromPair(mint, pair(key()))).toBeNull();
    expect(quoteFromPair(mint, pair(mint, { chainId: "ethereum" }))).toBeNull();
  });

  it("returns null fields (not zero) for missing or malicious values", () => {
    const mint = key();
    const q = quoteFromPair(mint, pair(mint, { priceUsd: "NaN", marketCap: -5, fdv: 1e30, volume: {}, priceChange: { h24: "lots" }, liquidity: null, quoteToken: { address: key() } }))!;
    expect(q).toMatchObject({ priceUsd: null, marketCapUsd: null, fdvUsd: null, volume24hUsd: null, change24hPct: null, liquidityUsd: null, priceSol: null });
  });

  it("rejects malformed pair objects", () => {
    expect(quoteFromPair(key(), { hello: "world" })).toBeNull();
    expect(quoteFromPair(key(), null)).toBeNull();
  });

  it("batches up to 30 mints per call and picks the most liquid pair", async () => {
    providerBudgets.dexscreener.reset();
    const mints = Array.from({ length: 31 }, key);
    const fetchImpl = vi.fn(async (url: string) => {
      const batch = url.split("/").pop()!.split(",");
      const body = batch.flatMap((m) => [pair(m, { liquidity: { usd: 10 }, priceUsd: "1" }), pair(m, { liquidity: { usd: 99 }, priceUsd: "2" })]);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const p = createDexScreenerProvider({ timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await p.getQuotes([...mints, "not-a-key"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.size).toBe(31);
    expect(out.get(mints[0])!.priceUsd).toBe(2);
  });

  it("surfaces provider rate limiting as a ProviderError", async () => {
    providerBudgets.dexscreener.reset();
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const p = createDexScreenerProvider({ timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    await expect(p.getQuotes([key()])).rejects.toMatchObject({ kind: "rate_limited" });
  });
});

describe("GeckoTerminal OHLCV adapter", () => {
  it("parses rows, drops inconsistent candles and sorts ascending", () => {
    const rows = [
      [1700003600, 2, 3, 1, 2.5, 100],
      [1700000000, 1, 2, 0.5, 1.5, 50],
      [1700007200, 1, 0.5, 2, 1, 5], // high < low: dropped
      [1700010800, "x", 1, 1, 1, 1], // non-numeric: dropped
      [1700014400, 1, 1, 1, 1, null], // missing volume: kept with null
    ];
    const c = parseOhlcvList(rows);
    expect(c.map((x) => x.t)).toEqual([1700000000, 1700003600, 1700014400]);
    expect(c[2].volumeUsd).toBeNull();
  });

  it("builds the documented URL and returns null without a pool", async () => {
    providerBudgets.geckoterminal.reset();
    const mint = key();
    const pool = key();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [[1700000000, 1, 2, 0.5, 1.5, 9]] } } }), { status: 200 }));
    const p = createGeckoTerminalProvider({ timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await p.getCandles({ mint, poolAddress: null, range: "24h" })).toBeNull();
    const s = await p.getCandles({ mint, poolAddress: pool, range: "24h" });
    expect(s).toMatchObject({ interval: "15m", candles: [{ t: 1700000000, close: 1.5 }] });
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain(`/api/v2/networks/solana/pools/${pool}/ohlcv/minute?`);
    expect(url).toContain("aggregate=15");
    expect(url).toContain(`token=${mint}`);
  });

  it("stops calling the provider once its per-minute budget is spent", async () => {
    providerBudgets.geckoterminal.reset();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }), { status: 200 }));
    const p = createGeckoTerminalProvider({ timeoutMs: 1000, fetchImpl: fetchImpl as unknown as typeof fetch });
    for (let i = 0; i < 8; i++) await p.getCandles({ mint: key(), poolAddress: key(), range: "1h" });
    await expect(p.getCandles({ mint: key(), poolAddress: key(), range: "1h" })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });
});

describe("Helius getAsset parsing", () => {
  it("sanitises untrusted metadata", () => {
    const mint = key();
    const md = parseHeliusAsset(mint, {
      result: {
        id: mint,
        content: { metadata: { name: "<img src=x onerror=alert(1)>Starlet", symbol: "STARLET" + String.fromCharCode(0x202e) + "" }, links: { image: "javascript:alert(1)" } },
        token_info: { supply: 1e15, decimals: 6 },
      },
    })!;
    expect(md.name).toBe("img src=x onerror=alert(1)Starlet");
    expect(md.symbol).toBe("STARLET");
    expect(md.imageUrl).toBeNull();
    expect(md.supply).toBe("1000000000000000");
    expect(md.decimals).toBe(6);
  });
  it("ignores a response for a different asset id", () => {
    expect(parseHeliusAsset(key(), { result: { id: key() } })).toBeNull();
  });
  it("throws on malformed responses", () => {
    expect(() => parseHeliusAsset(key(), "garbage")).toThrow();
  });
});
