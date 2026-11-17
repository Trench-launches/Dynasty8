import { PROGRAMS } from "@/server/solana/address";
import type { SwapBuild, SwapInstructionJson } from "./jupiter";

/**
 * Pre-signing policy (pattern adapted from LaunchLoop lib/signer/policy.ts): a transaction
 * may only contain instructions from an explicit program allowlist, the only signer may be
 * the fund wallet, and the swap must spend exactly the approved budget into the target mint.
 * Anything not explicitly allowed is denied. This runs before any signature is requested,
 * whether from an automated signer or as a multisig proposal.
 */
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** Jupiter v6 aggregator (appears as swapInstruction.programId in Jupiter's documented examples). */
export const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

const SUPPORT_PROGRAMS = new Set([COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, PROGRAMS.TOKEN, PROGRAMS.TOKEN_2022]);

export interface SwapPolicy {
  fundWallet: string;
  targetMint: string;
  budgetLamports: bigint;
  maxPriceImpactBps: number;
  slippageBps: number;
  /** Programs allowed to be the swap instruction's program. */
  swapPrograms: string[];
}

function checkSigners(ix: SwapInstructionJson, fundWallet: string) {
  for (const a of ix.accounts) {
    if (a.isSigner && a.pubkey !== fundWallet) throw new PolicyViolation(`Unexpected signer ${a.pubkey} in ${ix.programId}`);
  }
}

export function assertSwapAllowed(b: SwapBuild, p: SwapPolicy): void {
  if (b.inputMint !== PROGRAMS.WRAPPED_SOL) throw new PolicyViolation("Buybacks must spend SOL");
  if (b.outputMint !== p.targetMint) throw new PolicyViolation("Swap output is not the target token");
  if (b.inAmount !== p.budgetLamports) throw new PolicyViolation("Swap input differs from the approved budget");
  if (b.priceImpactBps > p.maxPriceImpactBps) throw new PolicyViolation(`Price impact ${b.priceImpactBps} bps exceeds ${p.maxPriceImpactBps} bps`);
  if (b.slippageBps > p.slippageBps) throw new PolicyViolation("Slippage exceeds the configured tolerance");
  if (!p.swapPrograms.includes(b.instructions.swap.programId)) {
    throw new PolicyViolation(`Swap program ${b.instructions.swap.programId} is not allowlisted`);
  }
  const support = [...b.instructions.computeBudget, ...b.instructions.setup, ...(b.instructions.cleanup ? [b.instructions.cleanup] : []), ...b.instructions.other];
  for (const ix of support) {
    if (!SUPPORT_PROGRAMS.has(ix.programId)) throw new PolicyViolation(`Program ${ix.programId} is not allowlisted`);
    checkSigners(ix, p.fundWallet);
    // The only System instruction allowed is wrapping SOL into the fund's own WSOL account,
    // and ATA creations; both are bounded by the token program's own checks. Arbitrary
    // System transfers out of the fund are refused.
    if (ix.programId === SYSTEM_PROGRAM) assertSystemWrapOnly(ix, p);
  }
  checkSigners(b.instructions.swap, p.fundWallet);
}

/** System `Transfer` (index 2) from the fund, amount <= budget; nothing else. */
function assertSystemWrapOnly(ix: SwapInstructionJson, p: SwapPolicy) {
  const data = Buffer.from(ix.data, "base64");
  if (data.length !== 12 || data.readUInt32LE(0) !== 2) throw new PolicyViolation("Only SOL wrapping transfers are allowed");
  const lamports = data.readBigUInt64LE(4);
  if (ix.accounts[0]?.pubkey !== p.fundWallet || lamports > p.budgetLamports) {
    throw new PolicyViolation("SOL transfer exceeds the budget or does not come from the fund");
  }
}

/** A burn is a single BurnChecked of the target mint, from the fund's account, signed by the fund. */
export function assertBurnAllowed(
  ix: { programId: string; accounts: { pubkey: string; isSigner: boolean }[]; data: Buffer },
  p: { fundWallet: string; targetMint: string; tokenAccount: string; amount: bigint; decimals: number },
) {
  if (ix.programId !== PROGRAMS.TOKEN && ix.programId !== PROGRAMS.TOKEN_2022) throw new PolicyViolation("Burn must use an SPL token program");
  if (ix.data.length !== 10 || ix.data[0] !== 15) throw new PolicyViolation("Burn must be BurnChecked");
  if (ix.data.readBigUInt64LE(1) !== p.amount || ix.data[9] !== p.decimals) throw new PolicyViolation("Burn amount or decimals mismatch");
  const [account, mint, authority] = ix.accounts;
  if (account?.pubkey !== p.tokenAccount || mint?.pubkey !== p.targetMint || authority?.pubkey !== p.fundWallet || !authority.isSigner) {
    throw new PolicyViolation("Burn accounts do not match the fund's token account, mint and authority");
  }
}
