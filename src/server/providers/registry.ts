import "server-only";
import { getConfig } from "@/server/config";
import { createSolanaReader, type SolanaReader } from "@/server/solana/rpc";
import { createBirdeyeProvider } from "./birdeye";
import { createDexScreenerProvider } from "./dexscreener";
import { createGeckoTerminalProvider } from "./geckoterminal";
import { createHeliusProvider } from "./helius";
import type { ChartProvider, MarketDataProvider, TokenMetadataProvider } from "./types";

export interface Providers {
  market: MarketDataProvider[];
  charts: ChartProvider[];
  metadata: TokenMetadataProvider | null;
  solana: SolanaReader;
}

let override: Providers | null = null;
let built: Providers | null = null;

/** Builds adapters from config. Adapters whose credentials are missing are left out. */
export function getProviders(): Providers {
  if (override) return override;
  if (built) return built;
  const cfg = getConfig();
  const opts = { timeoutMs: cfg.PROVIDER_TIMEOUT_MS };
  built = {
    market: cfg.ENABLE_DEXSCREENER ? [createDexScreenerProvider(opts)] : [],
    charts: [
      ...(cfg.ENABLE_GECKOTERMINAL ? [createGeckoTerminalProvider(opts)] : []),
      ...(cfg.BIRDEYE_API_KEY ? [createBirdeyeProvider(cfg.BIRDEYE_API_KEY, opts)] : []),
    ],
    metadata: cfg.HELIUS_API_KEY ? createHeliusProvider(cfg.HELIUS_API_KEY, opts) : null,
    solana: createSolanaReader(cfg.SOLANA_RPC_URL),
  };
  return built;
}

export function providerStatus(): Record<string, "enabled" | "disabled"> {
  const cfg = getConfig();
  return {
    dexscreener: cfg.ENABLE_DEXSCREENER ? "enabled" : "disabled",
    geckoterminal: cfg.ENABLE_GECKOTERMINAL ? "enabled" : "disabled",
    birdeye: cfg.BIRDEYE_API_KEY ? "enabled" : "disabled",
    helius: cfg.HELIUS_API_KEY ? "enabled" : "disabled",
    solanaRpc: "enabled",
  };
}

/** Test hook: inject mocked providers. */
export function setProvidersForTests(p: Providers | null) {
  override = p;
  built = null;
}
