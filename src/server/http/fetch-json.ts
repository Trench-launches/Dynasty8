import "server-only";
import { logger } from "@/server/logger";

/**
 * Outbound HTTP for provider adapters only.
 *
 * - SSRF: only hosts on the allowlist below can be called. URLs are built by adapters
 *   from fixed base URLs plus validated path segments; user input never supplies a URL.
 * - Timeouts via AbortController, bounded retries with exponential backoff + jitter,
 *   Retry-After honoured for 429, response size capped, JSON parse errors contained.
 */
export const ALLOWED_HOSTS = new Set([
  "api.dexscreener.com",
  "api.geckoterminal.com",
  "public-api.birdeye.so",
  "mainnet.helius-rpc.com",
  "api.jup.ag",
]);

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "rate_limited" | "http" | "invalid_response" | "network" | "blocked",
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  retries?: number;
  /** Max bytes accepted from the provider. */
  maxBytes?: number;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 60_000);
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.min(Math.max(0, d - Date.now()), 60_000) : undefined;
}

export async function fetchJson(url: string, opts: FetchJsonOptions): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ProviderError(`Host not allowed: ${parsed.hostname}`, "blocked");
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retries ?? 2;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let lastErr: ProviderError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await doFetch(url, {
        method: opts.method ?? "GET",
        headers: { accept: "application/json", ...(opts.body ? { "content-type": "application/json" } : {}), ...opts.headers },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        throw new ProviderError("Rate limited by provider", "rate_limited", 429, retryAfterMs);
      }
      if (!res.ok) {
        throw new ProviderError(`Provider HTTP ${res.status}`, "http", res.status);
      }
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > maxBytes) throw new ProviderError("Response too large", "invalid_response");
      const text = await res.text();
      if (text.length > maxBytes) throw new ProviderError("Response too large", "invalid_response");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderError("Malformed JSON from provider", "invalid_response");
      }
    } catch (e) {
      const err =
        e instanceof ProviderError
          ? e
          : (e as Error)?.name === "AbortError"
            ? new ProviderError("Provider timed out", "timeout")
            : new ProviderError("Network error calling provider", "network");
      lastErr = err;
      const retryable =
        err.kind === "timeout" ||
        err.kind === "network" ||
        err.kind === "rate_limited" ||
        (err.kind === "http" && (err.status ?? 0) >= 500);
      if (!retryable || attempt === retries) break;
      const backoff = err.retryAfterMs ?? Math.min(8_000, 400 * 2 ** attempt) + Math.floor(Math.random() * 200);
      logger.warn({ host: parsed.hostname, kind: err.kind, attempt }, "provider request failed, retrying");
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new ProviderError("Unknown provider failure", "network");
}
