import bs58 from "bs58";
import { AddressLookupTableAccount, Keypair, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import type { ChainReader, ChainTx, FlatInstruction, SignatureState } from "@/server/demolition/chain";
import { setDemolitionDepsForTests } from "@/server/demolition/deps";
import type { SwapBuild, SwapProvider } from "@/server/demolition/jupiter";
import { encodeDistributeEvent, PUMP_PROGRAMS, sharingConfigAddress } from "@/server/demolition/pump-fees";
import type { TransactionSigner } from "@/server/demolition/signer";
import { SQUADS_V4_PROGRAM, VAULT_TX_EXECUTE_DISCRIMINATOR, vaultAddress, type CanonicalMessage, type MultisigInfo, type ProposalState, type SquadsReader } from "@/server/demolition/squads";
import type { TxSender } from "@/server/demolition/executor";
import { JUPITER_V6_PROGRAM } from "@/server/demolition/policy";
import { PROGRAMS } from "@/server/solana/address";
import { db, newKey } from "./fixtures";

export const WSOL = PROGRAMS.WRAPPED_SOL;
export const sig = () => bs58.encode(Keypair.generate().secretKey.subarray(0, 64)); // 64-byte, base58, like a real signature

/** In-memory chain: finalized transactions, signature states, balances, block height. */
export class FakeChain implements ChainReader {
  txs = new Map<string, ChainTx>();
  states = new Map<string, SignatureState>();
  balances = new Map<string, bigint>();
  tokens = new Map<string, bigint>(); // `${owner}:${mint}`
  height = 1_000n;
  outage = false;
  signatures: { address: string; signature: string; slot: bigint; err: unknown }[] = [];

  private guard() {
    if (this.outage) throw new Error("RPC outage");
  }
  async getTransaction(s: string) {
    this.guard();
    return this.txs.get(s) ?? null;
  }
  async getSignaturesForAddress(address: string, opts: { until?: string; before?: string; limit: number }) {
    this.guard();
    const list = this.signatures.filter((x) => x.address === address).reverse(); // newest first
    let start = 0;
    if (opts.before) start = list.findIndex((x) => x.signature === opts.before) + 1;
    const out = [];
    for (const x of list.slice(start)) {
      if (x.signature === opts.until) break;
      out.push(x);
      if (out.length >= opts.limit) break;
    }
    return out;
  }
  async getSignatureState(s: string) {
    this.guard();
    return this.states.get(s) ?? { status: this.txs.has(s) ? ("finalized" as const) : null, err: null };
  }
  async getBalance(a: string) {
    this.guard();
    return this.balances.get(a) ?? 0n;
  }
  async getTokenBalance(owner: string, mint: string) {
    this.guard();
    return this.tokens.get(`${owner}:${mint}`) ?? 0n;
  }
  async getBlockHeight() {
    this.guard();
    return this.height;
  }
  accounts = new Map<string, { owner: string; data: Buffer }>();
  async getAccount(address: string) {
    this.guard();
    return this.accounts.get(address) ?? null;
  }
  /** Adds a finalized transaction and indexes it under the given addresses. */
  add(tx: ChainTx, indexFor: string[] = []) {
    this.txs.set(tx.signature, tx);
    for (const a of indexFor) this.signatures.push({ address: a, signature: tx.signature, slot: tx.slot, err: tx.err });
  }
}

function baseTx(signature: string, keys: string[], pre: bigint[], post: bigint[]): ChainTx {
  return {
    signature,
    slot: 123n,
    blockTime: new Date(),
    err: null,
    fee: 5_000n,
    accountKeys: keys,
    signers: [keys[0]!],
    preBalances: pre,
    postBalances: post,
    preTokenBalances: [],
    postTokenBalances: [],
    instructions: [],
  };
}

/** Pump distribute_creator_fees_v2: emits the event and pays the fund its share. */
export function distributeTx(p: { mint: string; fund: string; distributed: bigint; quoteMint?: string | null; shareBps?: number; otherHolders?: { address: string; shareBps: number }[]; fundDelta?: bigint; sharingConfig?: string; err?: unknown; signature?: string }): ChainTx {
  const shareBps = p.shareBps ?? 10_000;
  const share = (p.distributed * BigInt(shareBps)) / 10_000n;
  const cranker = newKey();
  const tx = baseTx(p.signature ?? sig(), [cranker, p.fund], [10_000_000n, 1_000_000n], [10_000_000n - 5_000n, 1_000_000n + (p.fundDelta ?? share)]);
  const data = encodeDistributeEvent({
    mint: p.mint,
    sharingConfig: p.sharingConfig ?? sharingConfigAddress(p.mint),
    shareholders: [{ address: p.fund, shareBps }, ...(p.otherHolders ?? [])],
    distributed: p.distributed,
    quoteMint: p.quoteMint ?? null,
  });
  tx.instructions = [
    { programId: PUMP_PROGRAMS.pump, data: bs58.encode(Buffer.from([1, 2, 3])), parsed: null, accounts: [], inner: false },
    { programId: PUMP_PROGRAMS.pump, data: bs58.encode(data), parsed: null, accounts: [], inner: true },
  ];
  tx.err = p.err ?? null;
  return tx;
}

/** A swap that spent `spent` lamports from the fund and delivered `received` target tokens to it. */
export function swapTx(p: { fund: string; mint: string; spent: bigint; received: bigint; err?: unknown; blockTime?: Date; signature?: string }): ChainTx {
  const member = newKey();
  const tx = baseTx(p.signature ?? sig(), [member, p.fund], [50_000_000n, 100_000_000_000n], [50_000_000n - 5_000n, 100_000_000_000n - p.spent]);
  tx.preTokenBalances = [{ accountIndex: 2, mint: p.mint, owner: p.fund, amount: 0n }];
  tx.postTokenBalances = [{ accountIndex: 2, mint: p.mint, owner: p.fund, amount: p.received }];
  tx.err = p.err ?? null;
  if (p.blockTime) tx.blockTime = p.blockTime;
  return tx;
}

/** A BurnChecked (inner, as executed by a multisig) of `amount` by `authority`. */
export function burnTx(p: { fund: string; mint: string; amount: bigint; authority?: string; balanceBefore?: bigint; balanceDrop?: bigint; err?: unknown; program?: string; signature?: string }): ChainTx {
  const member = newKey();
  const tx = baseTx(p.signature ?? sig(), [member, p.fund], [50_000_000n, 1_000_000n], [50_000_000n - 5_000n, 1_000_000n]);
  const before = p.balanceBefore ?? p.amount;
  tx.preTokenBalances = [{ accountIndex: 2, mint: p.mint, owner: p.fund, amount: before }];
  tx.postTokenBalances = [{ accountIndex: 2, mint: p.mint, owner: p.fund, amount: before - (p.balanceDrop ?? p.amount) }];
  const burn: FlatInstruction = {
    programId: p.program ?? PROGRAMS.TOKEN_2022,
    data: null,
    parsed: { type: "burnChecked", info: { account: newKey(), mint: p.mint, authority: p.authority ?? p.fund, tokenAmount: { amount: p.amount.toString(), decimals: 6 } } },
    accounts: [],
    inner: true,
  };
  tx.instructions = [{ programId: "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf", data: "1", parsed: null, accounts: [], inner: false }, burn];
  tx.err = p.err ?? null;
  return tx;
}

/** A plain SOL transfer from the fund to `dest`. */
export function transferTx(p: { fund: string; dest: string; lamports: bigint }): ChainTx {
  return baseTx(sig(), [newKey(), p.fund, p.dest], [10_000_000n, 1_000_000_000n, 0n], [10_000_000n - 5_000n, 1_000_000_000n - p.lamports, p.lamports]);
}

/** A Jupiter /build result that satisfies policy unless overridden. */
export function jupiterBuild(p: { fund: string; mint: string; amount: bigint; out?: bigint; minOut?: bigint; impactBps?: number; slippageBps?: number }, over: Partial<SwapBuild> = {}): SwapBuild {
  const out = p.out ?? 1_000_000_000n;
  return {
    source: "jupiter",
    inputMint: WSOL,
    outputMint: p.mint,
    inAmount: p.amount,
    outAmount: out,
    minOut: p.minOut ?? (out * 99n) / 100n,
    slippageBps: p.slippageBps ?? 100,
    priceImpactBps: p.impactBps ?? 50,
    routeLabels: ["PumpSwap"],
    instructions: {
      computeBudget: [{ programId: "ComputeBudget111111111111111111111111111111", accounts: [], data: "AwAAAAAAAAA=" }],
      setup: [],
      swap: { programId: JUPITER_V6_PROGRAM, accounts: [{ pubkey: p.fund, isSigner: true, isWritable: true }], data: "AQ==" },
      cleanup: null,
      other: [],
    },
    lookupTables: {},
    ...over,
  };
}

export class FakeSwap implements SwapProvider {
  name = "fake-jupiter";
  calls = 0;
  next: ((req: { amount: bigint; outputMint: string; taker: string; slippageBps: number }) => SwapBuild) | null = null;
  error: Error | null = null;
  async build(req: { inputMint: string; outputMint: string; amount: bigint; taker: string; slippageBps: number }) {
    this.calls++;
    if (this.error) throw this.error;
    if (!this.next) throw new Error("no build configured");
    return this.next(req);
  }
}

export const testSigner = (publicKey: string): TransactionSigner => ({
  publicKey,
  kind: "test",
  async signTransaction(tx: VersionedTransaction) {
    return tx;
  },
});

export interface DemolitionHarness {
  chain: FakeChain;
  swap: FakeSwap;
  squads: FakeSquads;
  now: { t: Date };
}

export function installDemolitionDeps(signer?: TransactionSigner): DemolitionHarness {
  const chain = new FakeChain();
  const swap = new FakeSwap();
  const squads = new FakeSquads(chain);
  const now = { t: new Date() };
  setDemolitionDepsForTests({
    chain,
    swap,
    squads,
    signer: signer ?? { publicKey: "", kind: "disabled", signTransaction: async () => { throw new Error("disabled"); } },
    now: () => now.t,
  });
  return { chain, swap, squads, now };
}

/**
 * Registers wallets, makes DYNASTY live with a fresh liquid market, and unpauses the fund.
 * Defaults model the single-signature test flow (FUND_ALLOW_SINGLE_SIG, FUND_SPLITS) used by
 * the original lifecycle tests; pass { multisig: harness.squads } and/or ON_CHAIN_SPLIT for
 * the production configuration.
 */
export async function setupFund(
  opts: { dynastyMint?: string; liquidityUsd?: number; paused?: boolean; multisig?: FakeSquads; mode?: "ON_CHAIN_SPLIT" | "FUND_SPLITS" } = {},
) {
  let fund = newKey();
  let multisigAddress: string | null = null;
  if (opts.multisig) {
    multisigAddress = opts.multisig.createMultisig();
    fund = vaultAddress(multisigAddress, 0);
  }
  const ecosystem = newKey();
  const operations = newKey();
  const dynasty = opts.dynastyMint ?? newKey();
  await db().treasuryWallet.createMany({
    data: [
      opts.multisig
        ? { role: "FUND", address: fund, label: "Demolition Fund (multisig)", isMultisig: true, multisigAddress, vaultIndex: 0, multisigThreshold: 2, multisigMembers: 3, multisigVerifiedAt: new Date() }
        : { role: "FUND", address: fund, label: "Demolition Fund (single-sig, test only)", isMultisig: false },
      { role: "ECOSYSTEM", address: ecosystem, label: "Ecosystem", isMultisig: false },
      { role: "OPERATIONS", address: operations, label: "Operations", isMultisig: false },
    ],
  });
  const native = await db().token.findFirstOrThrow({ where: { isNative: true } });
  await db().token.update({ where: { id: native.id }, data: { mintAddress: dynasty, deploymentStatus: "LIVE", metadataStatus: "VERIFIED", decimals: 6 } });
  await db().marketSnapshot.create({ data: { tokenId: native.id, source: "test", liquidityUsd: opts.liquidityUsd ?? 250_000, priceUsd: 0.001 } });
  await db().fundConfig.upsert({
    where: { id: 1 },
    create: { id: 1, paused: opts.paused ?? false, pausedReason: null, requiredApprovals: 1, cooldownSeconds: 60, allocationMode: opts.mode ?? "FUND_SPLITS" },
    update: { paused: opts.paused ?? false, pausedReason: null, requiredApprovals: 1, cooldownSeconds: 60, allocationMode: opts.mode ?? "FUND_SPLITS" },
  });
  return { fund, ecosystem, operations, dynasty, nativeId: native.id, multisigAddress };
}

/** A recording, non-broadcasting sender for executor tests. */
export class FakeSender implements TxSender {
  sent: { signature: string; count: number }[] = [];
  crashAfterSign = false;
  async send(instructions: unknown[], _l: Record<string, string[]>, _s: TransactionSigner, onSigned: (sig: string, lvbh: bigint) => Promise<void>) {
    const signature = sig();
    await onSigned(signature, 2_000n);
    if (this.crashAfterSign) throw new Error("process crashed before broadcast");
    this.sent.push({ signature, count: instructions.length });
    return signature;
  }
}

// ── Squads simulator ─────────────────────────────────────────────────────────

/**
 * In-memory Squads v4: multisig accounts, vault transactions and proposals, driven by the
 * same PDAs and message bytes as production. Member actions (create, approve, execute) are
 * simulated; execution adds a finalized transaction with a byte-exact
 * vault_transaction_execute instruction to the fake chain.
 */
export class FakeSquads implements SquadsReader {
  multisigs = new Map<string, MultisigInfo>();
  vaultTxs = new Map<string, CanonicalMessage>();
  proposals = new Map<string, ProposalState>();
  configTxs = new Set<string>();
  members: string[] = [];
  outage = false;
  constructor(private chain: FakeChain) {}

  createMultisig(threshold = 2, memberCount = 3): string {
    const address = newKey();
    this.members = Array.from({ length: memberCount }, newKey);
    this.multisigs.set(address, {
      address,
      threshold,
      timeLockSeconds: 0,
      transactionIndex: 0n,
      staleTransactionIndex: 0n,
      configAuthority: null,
      members: this.members.map((key) => ({ key, initiate: true, vote: true, execute: true })),
    });
    return address;
  }
  async readMultisig(address: string) {
    if (this.outage) throw new Error("RPC outage");
    return this.multisigs.get(address) ?? null;
  }
  async readProposal(pda: string) {
    if (this.outage) throw new Error("RPC outage");
    return this.proposals.get(pda) ?? null;
  }
  async readVaultTransactionMessage(pda: string) {
    if (this.outage) throw new Error("RPC outage");
    if (this.configTxs.has(pda)) return "OTHER" as const;
    return this.vaultTxs.get(pda) ?? null;
  }
  async getLatestBlockhash() {
    return PublicKey.default.toBase58();
  }
  async getLookupTables(addresses: string[]) {
    return addresses.map(
      (a) =>
        new AddressLookupTableAccount({
          key: new PublicKey(a),
          state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: [] },
        }),
    );
  }

  /** A member signs and sends the prepared creation transaction (optionally with a tampered message). */
  memberCreates(p: { multisig: string; transactionIndex: bigint; vaultTransactionPda: string; proposalPda: string }, message: CanonicalMessage) {
    const ms = this.multisigs.get(p.multisig)!;
    if (p.transactionIndex !== ms.transactionIndex + 1n) throw new Error("index already used");
    ms.transactionIndex = p.transactionIndex;
    this.vaultTxs.set(p.vaultTransactionPda, message);
    this.proposals.set(p.proposalPda, { status: "Active", approved: [], rejected: [], transactionIndex: p.transactionIndex });
  }
  /** Someone else uses the next transaction index (e.g. a config change). */
  bumpIndex(multisig: string, configTxPda?: string) {
    this.multisigs.get(multisig)!.transactionIndex += 1n;
    if (configTxPda) this.configTxs.add(configTxPda);
  }
  approve(multisig: string, proposalPda: string, member: string) {
    const p = this.proposals.get(proposalPda)!;
    p.approved.push(member);
    if (p.approved.length >= this.multisigs.get(multisig)!.threshold) p.status = "Approved";
  }
  reject(proposalPda: string) {
    this.proposals.get(proposalPda)!.status = "Rejected";
  }
  /** A member executes: marks the proposal executed and puts `effects` on chain with a real execute instruction. */
  execute(p: { multisig: string; proposalPda: string; vaultTransactionPda: string }, effects: ChainTx, member?: string) {
    this.proposals.get(p.proposalPda)!.status = "Executed";
    effects.accountKeys = [...effects.accountKeys, p.multisig, p.proposalPda, p.vaultTransactionPda];
    effects.instructions = [
      {
        programId: SQUADS_V4_PROGRAM,
        data: bs58.encode(VAULT_TX_EXECUTE_DISCRIMINATOR),
        parsed: null,
        accounts: [p.multisig, p.proposalPda, p.vaultTransactionPda, member ?? this.members[0]!],
        inner: false,
      },
      ...effects.instructions.map((i) => ({ ...i, inner: true })),
    ];
    this.chain.add(effects, [p.vaultTransactionPda]);
    return effects.signature;
  }
}
