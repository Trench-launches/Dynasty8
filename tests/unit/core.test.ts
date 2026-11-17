import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { fetchJson, ProviderError } from "@/server/http/fetch-json";
import { createMemoryCache } from "@/server/cache";
import { createRateLimiter } from "@/server/http/rate-limit";
import { finiteNonNegative, sanitizeHttpsUrl, sanitizeText } from "@/server/sanitize";
import { isValidPublicKey, PROGRAMS } from "@/server/solana/address";
import { decodePumpCurveComplete, derivePumpCurveAddress, PUMP_CURVE_COMPLETE_OFFSET } from "@/server/solana/rpc";

describe("Solana address validation", () => {
  it("accepts real public keys", () => {
    expect(isValidPublicKey(Keypair.generate().publicKey.toBase58())).toBe(true);
    expect(isValidPublicKey(PROGRAMS.WRAPPED_SOL)).toBe(true);
  });
  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["non-base58 chars (0, O, I, l)", "0OIl" + "1".repeat(40)],
    ["whitespace", ` ${PROGRAMS.TOKEN}`],
    ["sql-ish", "'; DROP TABLE \"Token\"; --"],
    ["ethereum address", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"],
    ["number", 12345],
    ["too long", "1".repeat(60)],
  ])("rejects %s", (_, v) => {
    expect(isValidPublicKey(v)).toBe(false);
  });
});

describe("Pump.fun bonding curve helpers", () => {
  it("derives the PDA from seeds ['bonding-curve', mint] under the Pump program", () => {
    const mint = Keypair.generate().publicKey;
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      new PublicKey(PROGRAMS.PUMP),
    );
    expect(derivePumpCurveAddress(mint.toBase58())).toBe(expected.toBase58());
  });
  it("decodes the complete flag after 8-byte discriminator + 5 u64 fields", () => {
    const data = new Uint8Array(PUMP_CURVE_COMPLETE_OFFSET + 10);
    expect(decodePumpCurveComplete(data)).toBe(false);
    data[PUMP_CURVE_COMPLETE_OFFSET] = 1;
    expect(decodePumpCurveComplete(data)).toBe(true);
    data[PUMP_CURVE_COMPLETE_OFFSET] = 7;
    expect(decodePumpCurveComplete(data)).toBeNull();
    expect(decodePumpCurveComplete(new Uint8Array(10))).toBeNull();
  });
});

describe("sanitisation of untrusted provider data", () => {
  it("strips markup, control and bidi characters and truncates", () => {
    expect(sanitizeText("<script>alert(1)</script>COIN", 50)).toBe("scriptalert(1)/scriptCOIN");
    expect(sanitizeText("A" + String.fromCharCode(0x202e) + "gnp.exe", 50)).toBe("Agnp.exe");
    expect(sanitizeText("x".repeat(100), 10)).toHaveLength(10);
    expect(sanitizeText(42, 10)).toBeNull();
    expect(sanitizeText("   ", 10)).toBeNull();
  });
  it("only accepts https URLs without credentials", () => {
    expect(sanitizeHttpsUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(sanitizeHttpsUrl("http://cdn.example.com/a.png")).toBeNull();
    expect(sanitizeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHttpsUrl("https://user:pw@evil.com/")).toBeNull();
    expect(sanitizeHttpsUrl("data:image/png;base64,AAAA")).toBeNull();
  });
  it("treats non-finite and negative numbers as unavailable, not zero", () => {
    expect(finiteNonNegative("0.0004")).toBe(0.0004);
    expect(finiteNonNegative(0)).toBe(0);
    expect(finiteNonNegative("NaN")).toBeNull();
    expect(finiteNonNegative(-1)).toBeNull();
    expect(finiteNonNegative(Infinity)).toBeNull();
    expect(finiteNonNegative(undefined)).toBeNull();
  });
});

function res(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe("fetchJson (provider HTTP)", () => {
  const sleep = vi.fn(async () => {});

  it("blocks hosts outside the allowlist (SSRF)", async () => {
    const f = vi.fn();
    await expect(fetchJson("https://169.254.169.254/latest/meta-data", { timeoutMs: 100, fetchImpl: f })).rejects.toMatchObject({ kind: "blocked" });
    await expect(fetchJson("http://api.dexscreener.com/x", { timeoutMs: 100, fetchImpl: f })).rejects.toMatchObject({ kind: "blocked" });
    expect(f).not.toHaveBeenCalled();
  });

  it("times out and retries, then reports a timeout", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    await expect(fetchJson("https://api.dexscreener.com/x", { timeoutMs: 20, retries: 1, fetchImpl: f as unknown as typeof fetch, sleep })).rejects.toMatchObject({ kind: "timeout" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("honours Retry-After on 429 and succeeds on retry", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429, "", { "retry-after": "3" })).mockResolvedValueOnce(res(200, '{"ok":true}'));
    const s = vi.fn(async () => {});
    await expect(fetchJson("https://api.dexscreener.com/x", { timeoutMs: 1000, fetchImpl: f, sleep: s })).resolves.toEqual({ ok: true });
    expect(s).toHaveBeenCalledWith(3000);
  });

  it("gives up after repeated rate limits with kind rate_limited", async () => {
    const f = vi.fn().mockResolvedValue(res(429, ""));
    await expect(fetchJson("https://api.dexscreener.com/x", { timeoutMs: 1000, retries: 2, fetchImpl: f, sleep })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx client errors", async () => {
    const f = vi.fn().mockResolvedValue(res(404, "nope"));
    await expect(fetchJson("https://api.dexscreener.com/x", { timeoutMs: 1000, fetchImpl: f, sleep })).rejects.toMatchObject({ kind: "http", status: 404 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and oversized responses", async () => {
    await expect(fetchJson("https://api.dexscreener.com/x", { timeoutMs: 1000, fetchImpl: vi.fn().mockResolvedValue(res(200, "{not json")), sleep })).rejects.toMatchObject({ kind: "invalid_response" });
    await expect(fetchJson("https://api.dexscreener.com/x", { timeoutMs: 1000, maxBytes: 10, fetchImpl: vi.fn().mockResolvedValue(res(200, '{"a":"xxxxxxxxxxxxxxxx"}')), sleep })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("cache and rate limiter", () => {
  it("de-duplicates concurrent loads and expires entries", async () => {
    const c = createMemoryCache();
    const load = vi.fn(async () => 1);
    await Promise.all([c.wrap("k", 1000, load), c.wrap("k", 1000, load)]);
    expect(load).toHaveBeenCalledTimes(1);
    c.set("e", 1, -1);
    expect(c.get("e")).toBeUndefined();
  });
  it("limits per key per window", () => {
    let t = 0;
    const rl = createRateLimiter(2, 1000, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("a"), rl.take("b")]).toEqual([true, true, false, true]);
    t = 1000;
    expect(rl.take("a")).toBe(true);
  });
});
