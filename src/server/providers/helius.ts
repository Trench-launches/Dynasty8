import "server-only";
import { z } from "zod";
import { fetchJson, ProviderError, type FetchJsonOptions } from "@/server/http/fetch-json";
import { providerBudgets } from "@/server/http/rate-limit";
import { sanitizeHttpsUrl, sanitizeText } from "@/server/sanitize";
import { isValidPublicKey } from "@/server/solana/address";
import type { TokenMetadata, TokenMetadataProvider } from "./types";

/**
 * Helius DAS `getAsset` (helius.dev/docs/api-reference/das/getasset), JSON-RPC POST to
 * https://mainnet.helius-rpc.com/?api-key=KEY. Fields used: content.metadata.{name,symbol},
 * content.links.image, token_info.{supply,decimals}. All values are treated as untrusted.
 * The image URL is stored for display only; the server never fetches it.
 */
const resultSchema = z.object({
  result: z
    .object({
      id: z.string(),
      content: z
        .object({
          metadata: z.object({ name: z.unknown().optional(), symbol: z.unknown().optional() }).passthrough().optional(),
          links: z.object({ image: z.unknown().optional() }).passthrough().optional(),
        })
        .passthrough()
        .optional(),
      token_info: z
        .object({ supply: z.unknown().optional(), decimals: z.unknown().optional() })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .nullish(),
  error: z.unknown().optional(),
});

export function parseHeliusAsset(mint: string, body: unknown): TokenMetadata | null {
  const parsed = resultSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError("Unexpected Helius response", "invalid_response");
  const r = parsed.data.result;
  if (!r || r.id !== mint) return null;
  const supplyRaw = r.token_info?.supply;
  const decimalsRaw = r.token_info?.decimals;
  return {
    source: "helius",
    name: sanitizeText(r.content?.metadata?.name, 64),
    symbol: sanitizeText(r.content?.metadata?.symbol, 16),
    imageUrl: sanitizeHttpsUrl(r.content?.links?.image),
    supply:
      typeof supplyRaw === "number" && Number.isSafeInteger(supplyRaw)
        ? String(supplyRaw)
        : typeof supplyRaw === "string" && /^\d{1,30}$/.test(supplyRaw)
          ? supplyRaw
          : null,
    decimals: typeof decimalsRaw === "number" && Number.isInteger(decimalsRaw) && decimalsRaw >= 0 && decimalsRaw <= 18 ? decimalsRaw : null,
  };
}

export function createHeliusProvider(apiKey: string, opts: Pick<FetchJsonOptions, "timeoutMs" | "fetchImpl" | "sleep">): TokenMetadataProvider {
  return {
    name: "helius",
    async getMetadata(mint) {
      if (!isValidPublicKey(mint)) return null;
      if (!providerBudgets.helius.take("helius")) throw new ProviderError("Helius budget exhausted", "rate_limited");
      const body = await fetchJson(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
        ...opts,
        method: "POST",
        body: { jsonrpc: "2.0", id: "dynasty8", method: "getAsset", params: { id: mint } },
      });
      return parseHeliusAsset(mint, body);
    },
  };
}
