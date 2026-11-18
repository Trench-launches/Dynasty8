import "server-only";
import type { MultisigProposal } from "@prisma/client";
import { prisma } from "@/server/db";
import { ProviderError } from "@/server/http/fetch-json";
import { ApiError } from "@/server/http/responses";
import { logger } from "@/server/logger";
import { recordAudit, SYSTEM_ACTOR, type Actor } from "@/server/services/audit";
import { burnProposal, getRequest, recordBurnSubmission, recordSwapSubmission, swapProposal } from "./buyback";
import { getDemolitionDeps } from "./deps";
import { assertOperational, getFundConfig, openCircuit, requireExecutableFund } from "./fund";
import type { SwapInstructionJson } from "./jupiter";
import { buildVaultProposal, executedViaProposal, messageHash, ProposalBuildError, toInstruction, type CanonicalMessage } from "./squads";

/**
 * Squads proposals for buyback swaps and burns.
 *
 *   prepare  -> PREPARED   unsigned creation tx returned to a multisig member (nothing executes)
 *   sync     -> CREATED    the on-chain vault transaction message matches what we proposed
 *            -> MISMATCH   it does not: circuit breaker opens; never counted
 *            -> APPROVED   threshold reached on-chain
 *            -> EXECUTED   a member executed it; the execution signature drives settlement
 *            -> REJECTED / CANCELLED / STALE
 *
 * The backend never signs, approves or executes. A swap or burn is accepted by settlement
 * only if it is the execution of the matching proposal (see buyback.ts multisig binding).
 */
export interface PreparedProposal {
  proposalId: string;
  purpose: "SWAP" | "BURN";
  multisig: string;
  vault: string;
  transactionIndex: bigint;
  proposalPda: string;
  vaultTransactionPda: string;
  creator: string;
  threshold: number;
  /** Unsigned v0 transaction for the creator to sign and send. Creating does not execute. */
  transactionBase64: string;
  transactionBytes: number;
  /** The exact inner message the vault will execute, for member review before signing. */
  expectedMessage: CanonicalMessage;
  summary: Record<string, unknown>;
}

const LIVE = ["PREPARED", "CREATED", "APPROVED", "EXECUTED"] as const;

export async function prepareProposal(requestId: string, purpose: "SWAP" | "BURN", creator: string, actor: Actor): Promise<PreparedProposal> {
  const fund = await requireExecutableFund();
  if (!fund.isMultisig || !fund.multisigAddress) throw new ApiError(422, "UNPROCESSABLE", "The fund wallet is not a registered multisig vault");
  assertOperational(await getFundConfig());
  const { squads } = getDemolitionDeps();

  const existing = await prisma.multisigProposal.findFirst({ where: { requestId, purpose, status: { in: [...LIVE] } } });
  if (existing && existing.status !== "PREPARED") throw new ApiError(409, "CONFLICT", `A ${purpose.toLowerCase()} proposal is already ${existing.status.toLowerCase()}`);
  if (existing) {
    // A prepared-but-unsent proposal can be replaced, unless it reached the chain meanwhile.
    let prior;
    try {
      prior = await squads.readVaultTransactionMessage(existing.vaultTransactionPda);
    } catch {
      // Fail closed: without knowing whether it reached the chain, never prepare a second one.
      throw new ApiError(503, "INTERNAL", "Could not read multisig state from Solana; try again later");
    }
    if (prior && prior !== "OTHER") throw new ApiError(409, "CONFLICT", "The previous proposal was already created on-chain; sync it instead");
  }

  let instructions: SwapInstructionJson[];
  let lookupTables: string[] = [];
  let amount: bigint;
  let summary: Record<string, unknown>;
  if (purpose === "SWAP") {
    const { request, build } = await swapProposal(requestId);
    // Compute-budget instructions cannot run inside a vault transaction (no CPI); the
    // executing member sets compute limits on the outer execute transaction instead.
    instructions = [...build.instructions.setup, build.instructions.swap, ...(build.instructions.cleanup ? [build.instructions.cleanup] : []), ...build.instructions.other];
    lookupTables = Object.keys(build.lookupTables);
    amount = request.budgetLamports;
    summary = { inLamports: build.inAmount, quotedOut: build.outAmount, minOut: build.minOut, priceImpactBps: build.priceImpactBps, route: build.routeLabels };
  } else {
    const { amount: burnAmount, instruction } = await burnProposal(requestId);
    instructions = [instruction];
    amount = burnAmount;
    summary = { burnRaw: burnAmount };
  }

  let draft;
  try {
    draft = await buildVaultProposal(squads, {
      multisig: fund.multisigAddress,
      vaultIndex: fund.vaultIndex,
      creator,
      instructions: instructions.map(toInstruction),
      lookupTableAddresses: lookupTables,
      memo: `dynasty8 ${purpose.toLowerCase()} ${requestId}`,
    });
  } catch (e) {
    if (e instanceof ProposalBuildError) throw new ApiError(422, "UNPROCESSABLE", e.message);
    throw new ApiError(503, "INTERNAL", "Could not read multisig state from Solana; try again later");
  }
  if (draft.vault !== fund.address) throw new ApiError(422, "UNPROCESSABLE", "Registered fund address is not this multisig's vault");

  const row = await prisma.$transaction(async (db) => {
    if (existing) await db.multisigProposal.delete({ where: { id: existing.id } });
    const created = await db.multisigProposal.create({
      data: {
        requestId,
        purpose,
        multisigAddress: draft.multisig,
        vaultIndex: draft.vaultIndex,
        transactionIndex: draft.transactionIndex,
        vaultTransactionPda: draft.vaultTransactionPda,
        proposalPda: draft.proposalPda,
        creator,
        messageHash: draft.expectedMessageHash,
        amount,
        threshold: draft.threshold,
        createdById: actor.id,
      },
    });
    await recordAudit(db, actor, existing ? "proposal.replaced" : "proposal.prepared", "Buyback", requestId, null, {
      purpose,
      transactionIndex: draft.transactionIndex,
      proposalPda: draft.proposalPda,
      messageHash: draft.expectedMessageHash,
      amount,
    });
    return created;
  });

  return {
    proposalId: row.id,
    purpose,
    multisig: draft.multisig,
    vault: draft.vault,
    transactionIndex: draft.transactionIndex,
    proposalPda: draft.proposalPda,
    vaultTransactionPda: draft.vaultTransactionPda,
    creator,
    threshold: draft.threshold,
    transactionBase64: draft.transactionBase64,
    transactionBytes: draft.transactionBytes,
    expectedMessage: draft.expectedMessage,
    summary,
  };
}

/** Finds the signature that executed this proposal (vault_transaction_execute), if any. */
async function findExecution(p: MultisigProposal): Promise<string | null> {
  const { chain } = getDemolitionDeps();
  const sigs = await chain.getSignaturesForAddress(p.vaultTransactionPda, { limit: 25 });
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await chain.getTransaction(s.signature);
    if (tx && executedViaProposal(tx, { multisig: p.multisigAddress, proposalPda: p.proposalPda, vaultTransactionPda: p.vaultTransactionPda })) return s.signature;
  }
  return null;
}

async function setStatus(p: MultisigProposal, data: Partial<MultisigProposal>, action: string) {
  await prisma.$transaction(async (db) => {
    const { count } = await db.multisigProposal.updateMany({ where: { id: p.id, status: p.status }, data });
    if (count === 1) await recordAudit(db, SYSTEM_ACTOR, action, "Buyback", p.requestId, { status: p.status }, data);
  });
}

/** Advances one proposal from on-chain state. Idempotent; safe to run from several workers. */
export async function syncProposal(p: MultisigProposal): Promise<MultisigProposal["status"]> {
  const { squads } = getDemolitionDeps();
  if (p.status === "PREPARED" || p.status === "CREATED" || p.status === "APPROVED") {
    // RPC failures propagate: a transient error must never change a proposal's state.
    const onChain = await squads.readVaultTransactionMessage(p.vaultTransactionPda);
    if (p.status === "PREPARED" && (onChain === null || onChain === "OTHER")) {
      const ms = await squads.readMultisig(p.multisigAddress);
      if (onChain === "OTHER" || (ms && ms.transactionIndex >= p.transactionIndex)) {
        await setStatus(p, { status: "STALE", note: "Transaction index was used by another multisig transaction" }, "proposal.stale");
        return "STALE";
      }
      return p.status; // not created yet
    }
    if (onChain === null || onChain === "OTHER" || messageHash(onChain) !== p.messageHash) {
      await setStatus(p, { status: "MISMATCH", note: "On-chain vault transaction differs from the prepared proposal" }, "proposal.mismatch");
      await prisma.$transaction((db) => openCircuit(db, `Proposal ${p.proposalPda} on-chain message does not match what was prepared`));
      return "MISMATCH";
    }
    if (p.status === "PREPARED") {
      await setStatus(p, { status: "CREATED" }, "proposal.created");
      p = { ...p, status: "CREATED" };
    }
    const state = await squads.readProposal(p.proposalPda);
    if (!state) return p.status;
    if (state.status === "Rejected") {
      await setStatus(p, { status: "REJECTED", approvals: state.approved.length }, "proposal.rejected");
      return "REJECTED";
    }
    if (state.status === "Cancelled") {
      await setStatus(p, { status: "CANCELLED", approvals: state.approved.length }, "proposal.cancelled");
      return "CANCELLED";
    }
    if (state.status === "Executed") {
      const sig = await findExecution(p);
      if (!sig) return p.status; // execution not finalized yet
      await setStatus(p, { status: "EXECUTED", approvals: state.approved.length, executedSignature: sig }, "proposal.executed");
      const req = await getRequest(p.requestId);
      try {
        if (p.purpose === "SWAP" && req.status === "APPROVED") await recordSwapSubmission(p.requestId, sig, SYSTEM_ACTOR);
        if (p.purpose === "BURN" && req.status === "SWAP_CONFIRMED") await recordBurnSubmission(p.requestId, sig, SYSTEM_ACTOR);
      } catch (e) {
        logger.warn({ proposal: p.id, err: e instanceof Error ? e.message : "unknown" }, "could not record executed proposal");
      }
      return "EXECUTED";
    }
    const approvals = state.approved.length;
    if (state.status === "Approved" && p.status !== "APPROVED") {
      await setStatus(p, { status: "APPROVED", approvals }, "proposal.approved");
      return "APPROVED";
    }
    if (approvals !== p.approvals) await prisma.multisigProposal.update({ where: { id: p.id }, data: { approvals } });
    return p.status;
  }
  return p.status;
}

export async function syncAllProposals() {
  const open = await prisma.multisigProposal.findMany({ where: { status: { in: ["PREPARED", "CREATED", "APPROVED"] } } });
  const out: Record<string, number> = {};
  for (const p of open) {
    try {
      const s = await syncProposal(p);
      out[s] = (out[s] ?? 0) + 1;
    } catch (e) {
      logger.warn({ proposal: p.id, kind: e instanceof ProviderError ? e.kind : "unknown" }, "proposal sync failed");
    }
  }
  return out;
}

/** Settlement binding: was `signature` the execution of this request's approved proposal? */
export async function bindExecution(requestId: string, purpose: "SWAP" | "BURN", signature: string, tx: Parameters<typeof executedViaProposal>[0]): Promise<boolean> {
  const candidates = await prisma.multisigProposal.findMany({ where: { requestId, purpose, status: { in: ["CREATED", "APPROVED", "EXECUTED"] } } });
  for (const p of candidates) {
    if (p.executedSignature && p.executedSignature !== signature) continue;
    if (!executedViaProposal(tx, { multisig: p.multisigAddress, proposalPda: p.proposalPda, vaultTransactionPda: p.vaultTransactionPda })) continue;
    if (p.status !== "EXECUTED") await setStatus(p, { status: "EXECUTED", executedSignature: signature }, "proposal.executed");
    return true;
  }
  return false;
}

export async function listProposals(requestId?: string) {
  return prisma.multisigProposal.findMany({ where: requestId ? { requestId } : undefined, orderBy: { createdAt: "desc" }, take: 100 });
}
