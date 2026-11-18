import "server-only";
import type { FundConfig, Prisma, TreasuryRole } from "@prisma/client";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { recordAudit, type Actor } from "@/server/services/audit";
import { isValidPublicKey } from "@/server/solana/address";
import { getConfig } from "@/server/config";
import { getDemolitionDeps } from "./deps";
import { assessMultisig, vaultAddress } from "./squads";

type Tx = Prisma.TransactionClient | typeof prisma;

export async function getFundConfig(tx: Tx = prisma): Promise<FundConfig> {
  return tx.fundConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export async function getWallet(role: TreasuryRole, tx: Tx = prisma) {
  return tx.treasuryWallet.findUnique({ where: { role } });
}

export async function requireFundWallet(tx: Tx = prisma) {
  const w = await getWallet("FUND", tx);
  if (!w) throw new ApiError(422, "UNPROCESSABLE", "The Demolition Fund wallet is not registered");
  return w;
}

/** The native token being bought back. Must be a verified, LIVE registry entry. */
export async function requireTargetToken(tx: Tx = prisma) {
  const t = await tx.token.findFirst({ where: { isNative: true } });
  if (!t || !t.mintAddress || t.deploymentStatus !== "LIVE" || t.metadataStatus !== "VERIFIED" || t.decimals === null) {
    throw new ApiError(422, "UNPROCESSABLE", "The native token has no verified, live mint; buybacks are unavailable");
  }
  return t as typeof t & { mintAddress: string; decimals: number };
}

/** Blocks new financial actions while paused or while the circuit breaker is open. */
export function assertOperational(cfg: FundConfig) {
  if (cfg.paused) throw new ApiError(423 as number, "UNPROCESSABLE", `Demolition Fund is paused: ${cfg.pausedReason ?? "no reason given"}`);
  if (cfg.circuitOpen) throw new ApiError(423 as number, "UNPROCESSABLE", `Circuit breaker open: ${cfg.circuitReason ?? "unknown"}`);
}

/**
 * The fund wallet buybacks may act on. In production it must be a verified Squads vault, so
 * no single key (and no backend hot wallet) can move fund money. A single-signature fund is
 * accepted only outside production with FUND_ALLOW_SINGLE_SIG=true (local testing).
 */
export async function requireExecutableFund(tx: Tx = prisma) {
  const w = await requireFundWallet(tx);
  if (w.isMultisig && w.multisigAddress && w.multisigVerifiedAt) return w;
  const cfg = getConfig();
  if (cfg.NODE_ENV !== "production" && cfg.FUND_ALLOW_SINGLE_SIG) return w;
  throw new ApiError(422, "UNPROCESSABLE", "The fund wallet must be a verified Squads multisig vault before buybacks can run");
}

export interface WalletInput {
  address: string;
  label: string;
  isMultisig: boolean;
  multisigAddress?: string | null;
  vaultIndex?: number;
}

/**
 * Registers a treasury wallet. A multisig vault is verified on-chain first: the account must
 * be a Squads v4 multisig whose vault `vaultIndex` is exactly `address`, and it must meet the
 * minimum policy (threshold >= 2, enough voters, an executor). Fails closed otherwise.
 */
export async function setWallet(role: TreasuryRole, input: WalletInput, actor: Actor) {
  const { address, label, isMultisig } = input;
  if (!isValidPublicKey(address)) throw new ApiError(400, "BAD_REQUEST", "Not a valid Solana address");
  let multisigFields: { multisigAddress: string | null; vaultIndex: number; multisigThreshold: number | null; multisigMembers: number | null; multisigVerifiedAt: Date | null } = {
    multisigAddress: null,
    vaultIndex: 0,
    multisigThreshold: null,
    multisigMembers: null,
    multisigVerifiedAt: null,
  };
  let assessmentWarnings: string[] = [];
  if (isMultisig) {
    const ms = input.multisigAddress;
    const vaultIndex = input.vaultIndex ?? 0;
    if (!ms || !isValidPublicKey(ms)) throw new ApiError(400, "BAD_REQUEST", "multisigAddress is required for a multisig wallet");
    if (vaultAddress(ms, vaultIndex) !== address) throw new ApiError(422, "UNPROCESSABLE", `Address is not vault ${vaultIndex} of multisig ${ms}`);
    let info;
    try {
      info = await getDemolitionDeps().squads.readMultisig(ms);
    } catch {
      throw new ApiError(503, "INTERNAL", "Could not read the multisig from Solana; try again later");
    }
    if (!info) throw new ApiError(422, "UNPROCESSABLE", "No Squads v4 multisig exists at that address");
    const assessment = assessMultisig(info);
    if (!assessment.ok) throw new ApiError(422, "UNPROCESSABLE", `Multisig does not meet the treasury policy: ${assessment.problems.join("; ")}`);
    assessmentWarnings = assessment.warnings;
    multisigFields = { multisigAddress: ms, vaultIndex, multisigThreshold: info.threshold, multisigMembers: info.members.length, multisigVerifiedAt: new Date() };
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.treasuryWallet.findUnique({ where: { role } });
    // Changing the fund wallet while money is in flight would orphan it.
    if (before && before.address !== address && role === "FUND") {
      const inFlight = await tx.buybackRequest.count({ where: { status: { in: ["APPROVED", "SWAP_SUBMITTED", "SWAP_CONFIRMED", "BURN_SUBMITTED"] } } });
      if (inFlight) throw new ApiError(409, "CONFLICT", "Finish or cancel in-flight buybacks before changing the fund wallet");
    }
    const after = await tx.treasuryWallet.upsert({
      where: { role },
      create: { role, address, label, isMultisig, ...multisigFields },
      update: { address, label, isMultisig, ...multisigFields },
    });
    await recordAudit(tx, actor, "fund.wallet_set", "Fund", null, before, { ...after, warnings: assessmentWarnings });
    return { ...after, warnings: assessmentWarnings };
  });
}

export async function updateFundConfig(patch: Partial<FundConfig>, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await getFundConfig(tx);
    const merged = { ...before, ...patch };
    if (merged.buybackBps + merged.ecosystemBps + merged.operationsBps !== 10_000) {
      throw new ApiError(422, "UNPROCESSABLE", "Allocation percentages must sum to 100%");
    }
    if (patch.autoExecutionEnabled === true) {
      throw new ApiError(422, "UNPROCESSABLE", "Unattended execution cannot be enabled through the API in this release");
    }
    const { id: _id, updatedAt: _u, ...data } = patch as FundConfig;
    void _id;
    void _u;
    const after = await tx.fundConfig.update({ where: { id: 1 }, data });
    await recordAudit(tx, actor, "fund.config_update", "Fund", null, before, after);
    return after;
  });
}

export async function setPaused(paused: boolean, reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await getFundConfig(tx);
    const after = await tx.fundConfig.update({ where: { id: 1 }, data: { paused, pausedReason: paused ? reason : null } });
    await recordAudit(tx, actor, paused ? "fund.pause" : "fund.resume", "Fund", null, { paused: before.paused }, { paused, reason });
    return after;
  });
}

export async function resetCircuit(reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await getFundConfig(tx);
    const after = await tx.fundConfig.update({ where: { id: 1 }, data: { circuitOpen: false, circuitReason: null, consecutiveFailures: 0 } });
    await recordAudit(tx, actor, "fund.circuit_reset", "Fund", null, { circuitReason: before.circuitReason }, { reason });
    return after;
  });
}

/** Counts a failure; opens the breaker after the configured number in a row. */
export async function recordFailure(tx: Tx, reason: string) {
  const cfg = await getFundConfig(tx);
  const n = cfg.consecutiveFailures + 1;
  const open = n >= cfg.maxConsecutiveFailures;
  await tx.fundConfig.update({
    where: { id: 1 },
    data: { consecutiveFailures: n, ...(open ? { circuitOpen: true, circuitReason: `${n} consecutive failures; last: ${reason}`.slice(0, 500) } : {}) },
  });
}

export async function recordSuccess(tx: Tx) {
  await tx.fundConfig.update({ where: { id: 1 }, data: { consecutiveFailures: 0 } });
}

export async function openCircuit(tx: Tx, reason: string) {
  await tx.fundConfig.update({ where: { id: 1 }, data: { circuitOpen: true, circuitReason: reason.slice(0, 500) } });
}
