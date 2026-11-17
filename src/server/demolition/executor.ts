import "server-only";
import bs58 from "bs58";
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from "@solana/web3.js";
import { getConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { logger } from "@/server/logger";
import { SYSTEM_ACTOR } from "@/server/services/audit";
import { burnProposal, recordBurnSubmission, recordSwapSubmission, swapProposal } from "./buyback";
import { getDemolitionDeps } from "./deps";
import { getFundConfig } from "./fund";
import type { SwapBuild, SwapInstructionJson } from "./jupiter";
import type { TransactionSigner } from "./signer";

/**
 * Unattended executor. It only runs when BOTH the owner has enabled automated execution
 * (database flag, not settable through the API) AND a real signer is configured. In this
 * release neither is true, so it is inert: the multisig proposal flow is the supported path.
 *
 * Order of operations for each transaction: build -> policy check (in buyback.ts) -> sign ->
 * record signature + lastValidBlockHeight -> broadcast. A crash after recording but before
 * broadcast leaves a SUBMITTED record that expires by block height; it is never re-signed blindly.
 */
export interface TxSender {
  send(
    instructions: SwapInstructionJson[],
    lookupTables: Record<string, string[]>,
    signer: TransactionSigner,
    onSigned: (signature: string, lastValidBlockHeight: bigint) => Promise<void>,
  ): Promise<string>;
}

const toIx = (j: SwapInstructionJson) =>
  new TransactionInstruction({
    programId: new PublicKey(j.programId),
    keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(j.data, "base64"),
  });

export function createRpcTxSender(rpcUrl = getConfig().SOLANA_RPC_URL): TxSender {
  const conn = new Connection(rpcUrl, { commitment: "confirmed" });
  return {
    async send(instructions, lookupTables, signer, onSigned) {
      const alts: AddressLookupTableAccount[] = [];
      for (const key of Object.keys(lookupTables)) {
        const res = await conn.getAddressLookupTable(new PublicKey(key));
        if (!res.value) throw new Error(`Lookup table ${key} not found`);
        alts.push(res.value);
      }
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({ payerKey: new PublicKey(signer.publicKey), recentBlockhash: blockhash, instructions: instructions.map(toIx) }).compileToV0Message(alts);
      const signed = await signer.signTransaction(new VersionedTransaction(msg));
      const signature = bs58.encode(signed.signatures[0]!);
      await onSigned(signature, BigInt(lastValidBlockHeight));
      await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      return signature;
    },
  };
}

function swapInstructions(b: SwapBuild): SwapInstructionJson[] {
  return [...b.instructions.computeBudget, ...b.instructions.setup, b.instructions.swap, ...(b.instructions.cleanup ? [b.instructions.cleanup] : []), ...b.instructions.other];
}

export type ExecutorResult = { action: "skipped"; reason: string } | { action: "swap" | "burn"; requestId: string; signature: string };

export async function runExecutor(sender: TxSender): Promise<ExecutorResult> {
  const cfg = await getFundConfig();
  const { signer } = getDemolitionDeps();
  if (!cfg.autoExecutionEnabled) return { action: "skipped", reason: "automated execution disabled" };
  if (signer.kind === "disabled") return { action: "skipped", reason: "no signer configured" };
  if (cfg.paused || cfg.circuitOpen) return { action: "skipped", reason: cfg.paused ? "paused" : "circuit open" };

  const approved = await prisma.buybackRequest.findFirst({ where: { status: "APPROVED" }, orderBy: { createdAt: "asc" } });
  if (approved) {
    const { build } = await swapProposal(approved.id);
    const signature = await sender.send(swapInstructions(build), build.lookupTables, signer, async (sig, lvbh) => {
      await recordSwapSubmission(approved.id, sig, SYSTEM_ACTOR, lvbh);
    });
    logger.info({ requestId: approved.id }, "buyback swap broadcast");
    return { action: "swap", requestId: approved.id, signature };
  }
  const confirmed = await prisma.buybackRequest.findFirst({ where: { status: "SWAP_CONFIRMED" }, orderBy: { createdAt: "asc" } });
  if (confirmed) {
    const { instruction } = await burnProposal(confirmed.id);
    const signature = await sender.send([instruction], {}, signer, async (sig, lvbh) => {
      await recordBurnSubmission(confirmed.id, sig, SYSTEM_ACTOR, lvbh);
    });
    logger.info({ requestId: confirmed.id }, "buyback burn broadcast");
    return { action: "burn", requestId: confirmed.id, signature };
  }
  return { action: "skipped", reason: "nothing to execute" };
}
