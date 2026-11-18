import "server-only";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import * as multisig from "@sqds/multisig";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import type { SwapInstructionJson } from "./jupiter";

/**
 * Squads v4 multisig integration (official SDK @sqds/multisig, program SQDS4ep65…).
 *
 * The backend only READS multisig state and BUILDS UNSIGNED transactions. Members sign
 * with their own wallets. Creating a proposal never executes it: execution needs the
 * multisig threshold of member approvals and a member's execute transaction.
 */
export const SQUADS_V4_PROGRAM = multisig.PROGRAM_ID.toBase58();
/** Solana's maximum serialized transaction size. */
export const MAX_TX_BYTES = 1232;

const PERM = { initiate: 1, vote: 2, execute: 4 } as const;

export interface MultisigMember {
  key: string;
  initiate: boolean;
  vote: boolean;
  execute: boolean;
}

export interface MultisigInfo {
  address: string;
  threshold: number;
  timeLockSeconds: number;
  transactionIndex: bigint;
  staleTransactionIndex: bigint;
  /** Null when the multisig is autonomous (config changes need member votes). */
  configAuthority: string | null;
  members: MultisigMember[];
}

export interface ProposalState {
  status: "Draft" | "Active" | "Rejected" | "Approved" | "Executing" | "Executed" | "Cancelled";
  approved: string[];
  rejected: string[];
  transactionIndex: bigint;
}

/** Read-only view of Squads accounts. Injected so tests can run without a network. */
export interface SquadsReader {
  readMultisig(address: string): Promise<MultisigInfo | null>;
  readProposal(proposalPda: string): Promise<ProposalState | null>;
  /**
   * Canonical message stored in a VaultTransaction account; null if the account does not
   * exist; "OTHER" if a different Squads account (e.g. a config transaction) occupies the
   * address. Throws only on RPC failure.
   */
  readVaultTransactionMessage(vaultTransactionPda: string): Promise<CanonicalMessage | null | "OTHER">;
  getLatestBlockhash(): Promise<string>;
  getLookupTables(addresses: string[]): Promise<AddressLookupTableAccount[]>;
  /**
   * The `vault_transaction_execute` instruction for an approved proposal, with the inner
   * message's accounts resolved from the on-chain VaultTransaction (built, never sent).
   */
  buildExecuteInstruction(multisig: string, transactionIndex: bigint, member: string): Promise<{ instruction: TransactionInstruction; lookupTables: AddressLookupTableAccount[] }>;
}

export const vaultAddress = (multisigPda: string, index = 0) =>
  multisig.getVaultPda({ multisigPda: new PublicKey(multisigPda), index })[0].toBase58();
export const transactionAddress = (multisigPda: string, index: bigint) =>
  multisig.getTransactionPda({ multisigPda: new PublicKey(multisigPda), index })[0].toBase58();
export const proposalAddress = (multisigPda: string, index: bigint) =>
  multisig.getProposalPda({ multisigPda: new PublicKey(multisigPda), transactionIndex: index })[0].toBase58();

const big = (n: unknown) => BigInt(String(n));

export function toMultisigInfo(address: string, m: multisig.accounts.Multisig): MultisigInfo {
  const ca = m.configAuthority.toBase58();
  return {
    address,
    threshold: m.threshold,
    timeLockSeconds: m.timeLock,
    transactionIndex: big(m.transactionIndex),
    staleTransactionIndex: big(m.staleTransactionIndex),
    configAuthority: ca === PublicKey.default.toBase58() ? null : ca,
    members: m.members.map((mem) => ({
      key: mem.key.toBase58(),
      initiate: (mem.permissions.mask & PERM.initiate) !== 0,
      vote: (mem.permissions.mask & PERM.vote) !== 0,
      execute: (mem.permissions.mask & PERM.execute) !== 0,
    })),
  };
}

export async function readMultisig(conn: Connection, address: string): Promise<MultisigInfo | null> {
  const info = await conn.getAccountInfo(new PublicKey(address), "finalized");
  if (!info || info.owner.toBase58() !== SQUADS_V4_PROGRAM) return null;
  if (!Buffer.from(info.data.subarray(0, 8)).equals(Buffer.from(multisig.accounts.multisigDiscriminator))) return null;
  const [m] = multisig.accounts.Multisig.fromAccountInfo(info);
  return toMultisigInfo(address, m);
}

export function createRpcSquadsReader(conn: Connection): SquadsReader {
  return {
    readMultisig: (a) => readMultisig(conn, a),
    async readProposal(pda) {
      const info = await conn.getAccountInfo(new PublicKey(pda), "finalized");
      if (!info || info.owner.toBase58() !== SQUADS_V4_PROGRAM) return null;
      const [p] = multisig.accounts.Proposal.fromAccountInfo(info);
      return { status: p.status.__kind, approved: p.approved.map((k) => k.toBase58()), rejected: p.rejected.map((k) => k.toBase58()), transactionIndex: big(p.transactionIndex) };
    },
    async readVaultTransactionMessage(pda) {
      const info = await conn.getAccountInfo(new PublicKey(pda), "finalized");
      if (!info) return null;
      if (info.owner.toBase58() !== SQUADS_V4_PROGRAM) return "OTHER";
      if (!Buffer.from(info.data.subarray(0, 8)).equals(Buffer.from(multisig.accounts.vaultTransactionDiscriminator))) return "OTHER";
      const [vt] = multisig.accounts.VaultTransaction.fromAccountInfo(info);
      return canonicalMessage(vt.message as unknown as RawMessage);
    },
    async getLatestBlockhash() {
      return (await conn.getLatestBlockhash("confirmed")).blockhash;
    },
    async getLookupTables(addresses) {
      const out: AddressLookupTableAccount[] = [];
      for (const a of addresses) {
        const res = await conn.getAddressLookupTable(new PublicKey(a));
        if (!res.value) throw new Error(`Lookup table ${a} not found`);
        out.push(res.value);
      }
      return out;
    },
    async buildExecuteInstruction(ms, transactionIndex, member) {
      const r = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda: new PublicKey(ms), transactionIndex, member: new PublicKey(member) });
      return { instruction: r.instruction, lookupTables: r.lookupTableAccounts };
    },
  };
}

// ── Member actions (approve / reject / execute) ─────────────────────────────

export type MemberAction = "approve" | "reject" | "execute";

/** Compute limit for executing a vault transaction that wraps a Jupiter swap (CPI-heavy). */
export const EXECUTE_SWAP_COMPUTE_UNITS = 1_000_000;

/**
 * Unsigned v0 transaction for one member action, fee payer = the member. The member signs
 * it in their own wallet; the backend never holds a key. Approve / reject only cast a vote;
 * execute succeeds on-chain only once the multisig threshold (and any time lock) is met.
 */
export async function buildMemberActionTransaction(
  reader: SquadsReader,
  p: { multisig: string; transactionIndex: bigint; member: string; action: MemberAction; computeUnits?: number; memo?: string },
): Promise<{ transactionBase64: string; transactionBytes: number }> {
  const msPk = new PublicKey(p.multisig);
  const memberPk = new PublicKey(p.member);
  const ixs: TransactionInstruction[] = [];
  let alts: AddressLookupTableAccount[] = [];
  if (p.action === "execute") {
    if (p.computeUnits) ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: p.computeUnits }));
    const built = await reader.buildExecuteInstruction(p.multisig, p.transactionIndex, p.member);
    ixs.push(built.instruction);
    alts = built.lookupTables;
  } else {
    const args = { multisigPda: msPk, transactionIndex: p.transactionIndex, member: memberPk, memo: p.memo?.slice(0, 120) };
    ixs.push(p.action === "approve" ? multisig.instructions.proposalApprove(args) : multisig.instructions.proposalReject(args));
  }
  const msg = new TransactionMessage({ payerKey: memberPk, recentBlockhash: await reader.getLatestBlockhash(), instructions: ixs }).compileToV0Message(alts);
  let bytes: Uint8Array;
  try {
    bytes = new VersionedTransaction(msg).serialize();
  } catch {
    throw new ProposalBuildError("Member transaction exceeds Solana's size limit");
  }
  if (bytes.length > MAX_TX_BYTES) throw new ProposalBuildError(`Member transaction is ${bytes.length} bytes (max ${MAX_TX_BYTES})`);
  return { transactionBase64: Buffer.from(bytes).toString("base64"), transactionBytes: bytes.length };
}

// ── Policy ──────────────────────────────────────────────────────────────────

export interface MultisigAssessment {
  ok: boolean;
  /** Blocking problems: buybacks refuse to run while any exist. */
  problems: string[];
  /** Non-blocking recommendations. */
  warnings: string[];
}

/**
 * Minimums for treasury multisigs: threshold >= 2, enough voting and executing members to
 * reach it, and threshold strictly below the member count (so one lost key cannot freeze
 * funds). Recommended: autonomous config and a time lock.
 */
export function assessMultisig(m: MultisigInfo, minThreshold = 2): MultisigAssessment {
  const problems: string[] = [];
  const warnings: string[] = [];
  const voters = m.members.filter((x) => x.vote).length;
  if (m.threshold < minThreshold) problems.push(`Threshold ${m.threshold} is below the required ${minThreshold}`);
  if (voters < m.threshold) problems.push(`Only ${voters} voting members for a threshold of ${m.threshold}`);
  if (!m.members.some((x) => x.execute)) problems.push("No member has execute permission");
  if (!m.members.some((x) => x.initiate)) problems.push("No member can initiate proposals");
  if (m.members.length <= m.threshold) warnings.push("Threshold equals member count: one lost key would freeze the treasury");
  if (m.configAuthority) warnings.push(`Config authority ${m.configAuthority} can change members without a vote; prefer an autonomous multisig`);
  if (m.timeLockSeconds === 0) warnings.push("No time lock: approved transactions can execute immediately");
  return { ok: problems.length === 0, problems, warnings };
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface CanonicalMessage {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: string[];
  instructions: { programIdIndex: number; accountIndexes: number[]; data: string }[];
  addressTableLookups: { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[];
}

type RawMessage = {
  numSigners: number;
  numWritableSigners: number;
  numWritableNonSigners: number;
  accountKeys: PublicKey[];
  instructions: { programIdIndex: number; accountIndexes: Uint8Array | number[]; data: Uint8Array | number[] }[];
  addressTableLookups: { accountKey: PublicKey; writableIndexes: Uint8Array | number[]; readonlyIndexes: Uint8Array | number[] }[];
};

export function canonicalMessage(m: RawMessage): CanonicalMessage {
  return {
    numSigners: m.numSigners,
    numWritableSigners: m.numWritableSigners,
    numWritableNonSigners: m.numWritableNonSigners,
    accountKeys: m.accountKeys.map((k) => k.toBase58()),
    instructions: m.instructions.map((i) => ({ programIdIndex: i.programIdIndex, accountIndexes: [...i.accountIndexes], data: Buffer.from(i.data).toString("base64") })),
    addressTableLookups: m.addressTableLookups.map((l) => ({ accountKey: l.accountKey.toBase58(), writableIndexes: [...l.writableIndexes], readonlyIndexes: [...l.readonlyIndexes] })),
  };
}

/** Decodes the multisig message bytes passed to vault_transaction_create. */
export function canonicalFromBytes(bytes: Uint8Array): CanonicalMessage {
  const [m] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(bytes));
  return canonicalMessage(m as unknown as RawMessage);
}

export const messageHash = (m: CanonicalMessage) => createHash("sha256").update(JSON.stringify(m)).digest("hex");

export const toInstruction = (j: SwapInstructionJson) =>
  new TransactionInstruction({
    programId: new PublicKey(j.programId),
    keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(j.data, "base64"),
  });

// ── Proposal construction (unsigned) ───────────────────────────────────────

export class ProposalBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalBuildError";
  }
}

export interface ProposalDraft {
  multisig: string;
  vault: string;
  vaultIndex: number;
  transactionIndex: bigint;
  vaultTransactionPda: string;
  proposalPda: string;
  creator: string;
  /** Unsigned v0 transaction (vault_transaction_create + proposal_create), base64. Fee payer: creator. */
  transactionBase64: string;
  transactionBytes: number;
  expectedMessage: CanonicalMessage;
  expectedMessageHash: string;
  threshold: number;
}

/**
 * Builds the unsigned transaction a multisig member signs to CREATE a proposal wrapping
 * `instructions` (executed by the vault). It does not approve or execute anything.
 */
export async function buildVaultProposal(
  reader: SquadsReader,
  p: { multisig: string; vaultIndex: number; creator: string; instructions: TransactionInstruction[]; lookupTableAddresses: string[]; memo: string },
): Promise<ProposalDraft> {
  const info = await reader.readMultisig(p.multisig);
  if (!info) throw new ProposalBuildError("Multisig account not found or not a Squads v4 multisig");
  const member = info.members.find((m) => m.key === p.creator);
  if (!member || !member.initiate) throw new ProposalBuildError("Proposal creator is not a multisig member with initiate permission");

  const vault = vaultAddress(p.multisig, p.vaultIndex);
  const vaultPk = new PublicKey(vault);
  // Inner instructions may only be signed by the vault itself.
  for (const ix of p.instructions) {
    for (const k of ix.keys) if (k.isSigner && !k.pubkey.equals(vaultPk)) throw new ProposalBuildError(`Inner instruction requires signer ${k.pubkey.toBase58()} other than the vault`);
  }
  const transactionIndex = info.transactionIndex + 1n;
  const alts = await reader.getLookupTables(p.lookupTableAddresses);
  // Squads replaces the blockhash at execution; any valid value works for the inner message.
  const inner = new TransactionMessage({ payerKey: vaultPk, recentBlockhash: PublicKey.default.toBase58(), instructions: p.instructions });
  const expectedBytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message: inner, addressLookupTableAccounts: alts, vaultPda: vaultPk });
  const expectedMessage = canonicalFromBytes(expectedBytes);

  const msPk = new PublicKey(p.multisig);
  const creatorPk = new PublicKey(p.creator);
  const create = multisig.instructions.vaultTransactionCreate({
    multisigPda: msPk,
    transactionIndex,
    creator: creatorPk,
    vaultIndex: p.vaultIndex,
    ephemeralSigners: 0,
    transactionMessage: inner,
    addressLookupTableAccounts: alts,
    memo: p.memo.slice(0, 120),
  });
  const propose = multisig.instructions.proposalCreate({ multisigPda: msPk, creator: creatorPk, transactionIndex });
  const outer = new TransactionMessage({ payerKey: creatorPk, recentBlockhash: await reader.getLatestBlockhash(), instructions: [create, propose] }).compileToV0Message();
  const tx = new VersionedTransaction(outer);
  let bytes: Uint8Array;
  try {
    bytes = tx.serialize();
  } catch {
    throw new ProposalBuildError("Proposal transaction exceeds Solana's size limit; reduce route accounts or use a transaction buffer");
  }
  if (bytes.length > MAX_TX_BYTES) throw new ProposalBuildError(`Proposal transaction is ${bytes.length} bytes (max ${MAX_TX_BYTES})`);

  return {
    multisig: p.multisig,
    vault,
    vaultIndex: p.vaultIndex,
    transactionIndex,
    vaultTransactionPda: transactionAddress(p.multisig, transactionIndex),
    proposalPda: proposalAddress(p.multisig, transactionIndex),
    creator: p.creator,
    transactionBase64: Buffer.from(bytes).toString("base64"),
    transactionBytes: bytes.length,
    expectedMessage,
    expectedMessageHash: messageHash(expectedMessage),
    threshold: info.threshold,
  };
}

/** Anchor discriminator of Squads v4 `vault_transaction_execute` (from @sqds/multisig). */
export const VAULT_TX_EXECUTE_DISCRIMINATOR = Buffer.from(multisig.generated.vaultTransactionExecuteInstructionDiscriminator);

/**
 * True when a successful transaction executed exactly this proposal: a top-level Squads
 * `vault_transaction_execute` whose accounts are [multisig, proposal, transaction, member, ...].
 * The creation transaction also touches these accounts, so the discriminator is required.
 */
export function executedViaProposal(
  tx: { err?: unknown; instructions: { programId: string; inner: boolean; data: string | null; accounts: string[] }[] },
  p: { multisig: string; proposalPda: string; vaultTransactionPda: string },
): boolean {
  if (tx.err) return false;
  return tx.instructions.some((i) => {
    if (i.inner || i.programId !== SQUADS_V4_PROGRAM || !i.data) return false;
    let data: Buffer;
    try {
      data = Buffer.from(bs58.decode(i.data));
    } catch {
      return false;
    }
    return (
      data.subarray(0, 8).equals(VAULT_TX_EXECUTE_DISCRIMINATOR) &&
      i.accounts[0] === p.multisig &&
      i.accounts[1] === p.proposalPda &&
      i.accounts[2] === p.vaultTransactionPda
    );
  });
}
