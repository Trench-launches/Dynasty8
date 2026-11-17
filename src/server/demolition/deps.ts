import "server-only";
import { getConfig } from "@/server/config";
import { createRpcChainReader, type ChainReader } from "./chain";
import { createJupiterSwapProvider, type SwapProvider } from "./jupiter";
import { disabledSigner, type TransactionSigner } from "./signer";

export interface DemolitionDeps {
  chain: ChainReader;
  swap: SwapProvider;
  signer: TransactionSigner;
  now: () => Date;
}

let override: DemolitionDeps | null = null;
let built: DemolitionDeps | null = null;

export function getDemolitionDeps(): DemolitionDeps {
  if (override) return override;
  if (built) return built;
  const cfg = getConfig();
  built = {
    chain: createRpcChainReader(cfg.SOLANA_RPC_URL),
    swap: createJupiterSwapProvider({ timeoutMs: cfg.PROVIDER_TIMEOUT_MS, apiKey: cfg.JUPITER_API_KEY }),
    // No production signer exists yet: see signer.ts.
    signer: disabledSigner,
    now: () => new Date(),
  };
  return built;
}

export function setDemolitionDepsForTests(d: DemolitionDeps | null) {
  override = d;
  built = null;
}
