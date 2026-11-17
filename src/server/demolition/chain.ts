import "server-only";
import { Connection, PublicKey, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js";
import { getConfig } from "@/server/config";

/**
 * Normalised, read-only view of finalized Solana transactions. Everything the Demolition
 * Fund verifies (receipts, swaps, burns, disbursements) goes through this interface, so
 * tests can drive it with fixtures and production uses finalized RPC data only.
 */
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner: string | null;
  /** Raw base units as a bigint. */
  amount: bigint;
}

export interface FlatInstruction {
  programId: string;
  /** Raw instruction data, base58 (only for instructions the RPC could not parse). */
  data: string | null;
  /** JSON-parsed form for known programs (System, SPL Token, Token-2022, ...). */
  parsed: { type: string; info: Record<string, unknown> } | null;
  /** Account addresses in instruction order (for partially decoded instructions). */
  accounts: string[];
  inner: boolean;
}

export interface ChainTx {
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  /** null when the transaction succeeded. */
  err: unknown;
  fee: bigint;
  accountKeys: string[];
  signers: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
  instructions: FlatInstruction[];
}

export interface SignatureInfo {
  signature: string;
  slot: bigint;
  err: unknown;
}

export interface SignatureState {
  status: "processed" | "confirmed" | "finalized" | null;
  err: unknown;
}

export interface ChainReader {
  /** Finalized transaction, or null if not (yet) finalized / unknown. */
  getTransaction(signature: string): Promise<ChainTx | null>;
  /** Newest first, stopping at `until` (exclusive). Finalized only. */
  getSignaturesForAddress(address: string, opts: { until?: string; before?: string; limit: number }): Promise<SignatureInfo[]>;
  getSignatureState(signature: string): Promise<SignatureState>;
  getBalance(address: string): Promise<bigint>;
  /** Sum of all token accounts of `owner` for `mint`, raw units. */
  getTokenBalance(owner: string, mint: string): Promise<bigint>;
  getBlockHeight(): Promise<bigint>;
}

const big = (n: number | string | undefined | null) => BigInt(n ?? 0);

function toTokenBalances(list: readonly { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[] | null | undefined): TokenBalance[] {
  return (list ?? []).map((b) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner ?? null, amount: BigInt(b.uiTokenAmount.amount) }));
}

function flat(ix: ParsedInstruction | PartiallyDecodedInstruction, inner: boolean): FlatInstruction {
  if ("parsed" in ix) {
    const p = ix.parsed as { type?: string; info?: Record<string, unknown> } | string;
    return {
      programId: ix.programId.toBase58(),
      data: null,
      parsed: typeof p === "object" && p?.type ? { type: p.type, info: p.info ?? {} } : null,
      accounts: [],
      inner,
    };
  }
  return { programId: ix.programId.toBase58(), data: ix.data, parsed: null, accounts: ix.accounts.map((a) => a.toBase58()), inner };
}

export function createRpcChainReader(rpcUrl = getConfig().SOLANA_RPC_URL): ChainReader {
  const conn = new Connection(rpcUrl, { commitment: "finalized", disableRetryOnRateLimit: true });
  return {
    async getTransaction(signature) {
      const tx = await conn.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      if (!tx || !tx.meta) return null;
      const keys = tx.transaction.message.accountKeys;
      const instructions: FlatInstruction[] = [];
      tx.transaction.message.instructions.forEach((ix, i) => {
        instructions.push(flat(ix, false));
        for (const group of tx.meta!.innerInstructions ?? []) {
          if (group.index === i) group.instructions.forEach((inner) => instructions.push(flat(inner, true)));
        }
      });
      return {
        signature,
        slot: BigInt(tx.slot),
        blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : null,
        err: tx.meta.err,
        fee: big(tx.meta.fee),
        accountKeys: keys.map((k) => k.pubkey.toBase58()),
        signers: keys.filter((k) => k.signer).map((k) => k.pubkey.toBase58()),
        preBalances: tx.meta.preBalances.map(big),
        postBalances: tx.meta.postBalances.map(big),
        preTokenBalances: toTokenBalances(tx.meta.preTokenBalances),
        postTokenBalances: toTokenBalances(tx.meta.postTokenBalances),
        instructions,
      };
    },
    async getSignaturesForAddress(address, opts) {
      const list = await conn.getSignaturesForAddress(new PublicKey(address), { until: opts.until, before: opts.before, limit: opts.limit }, "finalized");
      return list.map((s) => ({ signature: s.signature, slot: BigInt(s.slot), err: s.err }));
    },
    async getSignatureState(signature) {
      const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const v = value[0];
      return { status: v?.confirmationStatus ?? null, err: v?.err ?? null };
    },
    async getBalance(address) {
      return BigInt(await conn.getBalance(new PublicKey(address), "finalized"));
    },
    async getTokenBalance(owner, mint) {
      const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, "finalized");
      return res.value.reduce((sum, a) => sum + BigInt((a.account.data.parsed as { info: { tokenAmount: { amount: string } } }).info.tokenAmount.amount), 0n);
    },
    async getBlockHeight() {
      return BigInt(await conn.getBlockHeight("finalized"));
    },
  };
}

/** Lamport change of `address` in a transaction (post - pre). */
export function lamportDelta(tx: ChainTx, address: string): bigint {
  const i = tx.accountKeys.indexOf(address);
  if (i < 0) return 0n;
  return (tx.postBalances[i] ?? 0n) - (tx.preBalances[i] ?? 0n);
}

/** Token change for all accounts of `owner` holding `mint` (post - pre), raw units. */
export function tokenDelta(tx: ChainTx, owner: string, mint: string): bigint {
  const sum = (list: TokenBalance[]) => list.filter((b) => b.owner === owner && b.mint === mint).reduce((s, b) => s + b.amount, 0n);
  return sum(tx.postTokenBalances) - sum(tx.preTokenBalances);
}
