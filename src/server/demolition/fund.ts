import "server-only";
import type { FundConfig, Prisma, TreasuryRole } from "@prisma/client";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { recordAudit, type Actor } from "@/server/services/audit";
import { isValidPublicKey } from "@/server/solana/address";

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

export async function setWallet(role: TreasuryRole, address: string, label: string, isMultisig: boolean, actor: Actor) {
  if (!isValidPublicKey(address)) throw new ApiError(400, "BAD_REQUEST", "Not a valid Solana address");
  return prisma.$transaction(async (tx) => {
    const before = await tx.treasuryWallet.findUnique({ where: { role } });
    // Changing the fund wallet while money is in flight would orphan it.
    if (before && before.address !== address && role === "FUND") {
      const inFlight = await tx.buybackRequest.count({ where: { status: { in: ["APPROVED", "SWAP_SUBMITTED", "SWAP_CONFIRMED", "BURN_SUBMITTED"] } } });
      if (inFlight) throw new ApiError(409, "CONFLICT", "Finish or cancel in-flight buybacks before changing the fund wallet");
    }
    const after = await tx.treasuryWallet.upsert({
      where: { role },
      create: { role, address, label, isMultisig },
      update: { address, label, isMultisig },
    });
    await recordAudit(tx, actor, "fund.wallet_set", "Fund", null, before, after);
    return after;
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
