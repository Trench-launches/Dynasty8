import "server-only";
import { z } from "zod";
import { fetchJson, ProviderError, type FetchJsonOptions } from "@/server/http/fetch-json";
import { providerBudgets } from "@/server/http/rate-limit";
import { isValidPublicKey, PROGRAMS } from "@/server/solana/address";
import { parseRawAmount, ratioStringToBps } from "./money";

/**
 * Jupiter Swap API V2, GET /build (developers.jup.ag/docs/api-reference/swap/build,
 * read 2026-11-17): https://api.jup.ag/swap/v2/build?inputMint&outputMint&amount&taker&slippageBps
 * Returns the quote (inAmount, outAmount, otherAmountThreshold, priceImpactPct, routePlan)
 * and raw instructions (base64 data). ExactIn only. Header x-api-key optional (0.5 RPS keyless).
 *
 * The Metis v1 /quote + /swap-instructions endpoints used by older local projects are
 * documented as no longer maintained, so they are not used here.
 */
export interface SwapInstructionJson {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export interface SwapBuild {
  source: "jupiter";
  inputMint: string;
  outputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  /** Minimum output after slippage, enforced on-chain by the swap program. */
  minOut: bigint;
  slippageBps: number;
  priceImpactBps: number;
  routeLabels: string[];
  instructions: {
    computeBudget: SwapInstructionJson[];
    setup: SwapInstructionJson[];
    swap: SwapInstructionJson;
    cleanup: SwapInstructionJson | null;
    other: SwapInstructionJson[];
  };
  lookupTables: Record<string, string[]>;
}

export interface SwapProvider {
  readonly name: string;
  build(input: { inputMint: string; outputMint: string; amount: bigint; taker: string; slippageBps: number }): Promise<SwapBuild>;
}

const ixSchema = z.object({
  programId: z.string(),
  accounts: z.array(z.object({ pubkey: z.string(), isSigner: z.boolean(), isWritable: z.boolean() })).max(64),
  data: z.string().max(4_000),
});

const buildSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string(),
  outAmount: z.string(),
  otherAmountThreshold: z.string(),
  slippageBps: z.number(),
  priceImpactPct: z.union([z.string(), z.number()]),
  routePlan: z
    .array(z.object({ swapInfo: z.object({ label: z.string().max(80), inputMint: z.string(), outputMint: z.string() }).passthrough() }).passthrough())
    .min(1)
    .max(10),
  computeBudgetInstructions: z.array(ixSchema).max(4).default([]),
  setupInstructions: z.array(ixSchema).max(8).default([]),
  swapInstruction: ixSchema,
  cleanupInstruction: ixSchema.nullable().optional(),
  otherInstructions: z.array(ixSchema).max(4).default([]),
  addressesByLookupTableAddress: z.record(z.string(), z.array(z.string()).max(256)).nullable().optional(),
});

export class QuoteRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRejected";
  }
}

/** Validates a /build response against what we asked for. Throws QuoteRejected. */
export function parseBuild(body: unknown, req: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number }): SwapBuild {
  const p = buildSchema.safeParse(body);
  if (!p.success) throw new QuoteRejected("Malformed swap build response");
  const b = p.data;
  if (b.inputMint !== req.inputMint) throw new QuoteRejected("Quote input mint does not match the request");
  if (b.outputMint !== req.outputMint) throw new QuoteRejected("Quote output mint does not match the target token");
  const inAmount = parseRawAmount(b.inAmount);
  const outAmount = parseRawAmount(b.outAmount);
  const minOut = parseRawAmount(b.otherAmountThreshold);
  if (inAmount === null || outAmount === null || minOut === null) throw new QuoteRejected("Quote amounts are not integers");
  if (inAmount !== req.amount) throw new QuoteRejected("Quote input amount differs from the approved budget");
  if (outAmount <= 0n || minOut <= 0n || minOut > outAmount) throw new QuoteRejected("Quote output amounts are invalid");
  if (b.slippageBps > req.slippageBps) throw new QuoteRejected("Quote slippage exceeds the configured tolerance");
  // Independent check that the minimum output honours our slippage, whatever the provider claims.
  const floor = (outAmount * BigInt(10_000 - req.slippageBps)) / 10_000n;
  if (minOut < floor) throw new QuoteRejected("Quote minimum output is below the slippage floor");
  const impact = ratioStringToBps(b.priceImpactPct);
  if (impact === null) throw new QuoteRejected("Quote price impact missing");
  const last = b.routePlan[b.routePlan.length - 1]!.swapInfo;
  if (b.routePlan[0]!.swapInfo.inputMint !== req.inputMint || last.outputMint !== req.outputMint) {
    throw new QuoteRejected("Route does not start and end at the requested mints");
  }
  const allIx = [
    ...b.computeBudgetInstructions,
    ...b.setupInstructions,
    b.swapInstruction,
    ...(b.cleanupInstruction ? [b.cleanupInstruction] : []),
    ...b.otherInstructions,
  ];
  for (const ix of allIx) {
    if (!isValidPublicKey(ix.programId) || ix.accounts.some((a) => !isValidPublicKey(a.pubkey))) {
      throw new QuoteRejected("Swap instruction contains an invalid address");
    }
  }
  return {
    source: "jupiter",
    inputMint: b.inputMint,
    outputMint: b.outputMint,
    inAmount,
    outAmount,
    minOut,
    slippageBps: b.slippageBps,
    priceImpactBps: impact,
    routeLabels: b.routePlan.map((r) => r.swapInfo.label),
    instructions: {
      computeBudget: b.computeBudgetInstructions,
      setup: b.setupInstructions,
      swap: b.swapInstruction,
      cleanup: b.cleanupInstruction ?? null,
      other: b.otherInstructions,
    },
    lookupTables: b.addressesByLookupTableAddress ?? {},
  };
}

export function createJupiterSwapProvider(opts: Pick<FetchJsonOptions, "timeoutMs" | "fetchImpl" | "sleep"> & { apiKey?: string }): SwapProvider {
  return {
    name: "jupiter",
    async build(req) {
      if (!providerBudgets.jupiter.take("jupiter")) throw new ProviderError("Jupiter budget exhausted", "rate_limited");
      const qs = new URLSearchParams({
        inputMint: req.inputMint,
        outputMint: req.outputMint,
        amount: req.amount.toString(),
        taker: req.taker,
        slippageBps: String(req.slippageBps),
        wrapAndUnwrapSol: "true",
        maxAccounts: "48",
      });
      const body = await fetchJson(`https://api.jup.ag/swap/v2/build?${qs}`, {
        ...opts,
        headers: opts.apiKey ? { "x-api-key": opts.apiKey } : {},
        retries: 1,
      });
      return parseBuild(body, req);
    },
  };
}

export const WSOL_MINT = PROGRAMS.WRAPPED_SOL;
