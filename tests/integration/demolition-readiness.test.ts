import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { resetConfigForTests } from "@/server/config";
import { setSessionResolverForTests } from "@/server/auth/admin";
import {
  approveBuyback,
  associatedTokenAddress,
  createBuybackRequest,
  getRequest,
  pendingBuybackLamports,
  quoteBuyback,
  recordBurnSubmission,
  recordSwapSubmission,
  settleAll,
  settleSwap,
} from "@/server/demolition/buyback";
import { checkFeeSharing } from "@/server/demolition/fee-sharing";
import { setWallet, updateFundConfig } from "@/server/demolition/fund";
import { fundPass } from "@/server/jobs";
import { prepareProposal, syncAllProposals, type PreparedProposal } from "@/server/demolition/proposals";
import { encodeDistributeEvent, PUMP_PROGRAMS, sharingConfigAddress, SHARING_CONFIG_DISCRIMINATOR } from "@/server/demolition/pump-fees";
import { scanFundWallet, verifyAndRecordReceipt } from "@/server/demolition/receipts";
import { reconcile, recordDisbursement, ledgerTotals } from "@/server/demolition/reconcile";
import { getFundSummary, getPropertyContributions } from "@/server/demolition/dashboard";
import { vaultAddress } from "@/server/demolition/squads";
import { PROGRAMS } from "@/server/solana/address";
import { POST as actionRoute } from "@/app/api/admin/demolition-fund/buybacks/[id]/[action]/route";
import { GET as proposalsRoute } from "@/app/api/admin/demolition-fund/proposals/route";
import { db, installMockProviders, makeLive, newKey, params, resetDatabase, send, signInAs, validMint, get } from "../helpers/fixtures";
import { burnTx, distributeTx, installDemolitionDeps, jupiterBuild, setupFund, sig, swapTx, type DemolitionHarness } from "../helpers/demolition";
import type { ChainTx } from "@/server/demolition/chain";

const ADMIN = { id: "admin-1", label: "test-admin" };
const SOL = 1_000_000_000n;

let h: DemolitionHarness;
let starlet: { tokenId: string; mint: string };
let ocean: { tokenId: string; mint: string };

async function base() {
  await resetDatabase();
  const mocks = installMockProviders();
  h = installDemolitionDeps();
  starlet = await makeLive("starlet-motel");
  ocean = await makeLive("ocean-view-hotel");
  return mocks;
}

afterEach(() => {
  setSessionResolverForTests(null);
  process.env.FUND_ALLOW_SINGLE_SIG = "true";
  delete (process.env as Record<string, string | undefined>).NODE_ENV_OVERRIDE;
  resetConfigForTests();
});

/** A Pump distribute tx paying several wallets their shares (and crediting their balances). */
function splitDistributeTx(p: { mint: string; distributed: bigint; holders: { address: string; shareBps: number }[]; arrived?: Record<string, bigint>; quoteMint?: string | null }): ChainTx {
  const cranker = newKey();
  const keys = [cranker, ...p.holders.map((x) => x.address)];
  const pre = keys.map(() => 1_000_000n);
  const post = keys.map((k, i) => {
    if (i === 0) return 1_000_000n - 5_000n;
    const holder = p.holders.find((x) => x.address === k)!;
    const due = (p.distributed * BigInt(holder.shareBps)) / 10_000n;
    return 1_000_000n + (p.arrived?.[k] ?? due);
  });
  const data = encodeDistributeEvent({ mint: p.mint, sharingConfig: sharingConfigAddress(p.mint), shareholders: p.holders, distributed: p.distributed, quoteMint: p.quoteMint ?? "11111111111111111111111111111111" });
  return {
    signature: sig(),
    slot: 77n,
    blockTime: new Date(),
    err: null,
    fee: 5_000n,
    accountKeys: keys,
    signers: [cranker],
    preBalances: pre,
    postBalances: post,
    preTokenBalances: [],
    postTokenBalances: [],
    instructions: [
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(Buffer.from([255, 203, 19, 79, 244, 68, 8, 159, 0])), parsed: null, accounts: [], inner: false },
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(data), parsed: null, accounts: [], inner: true },
    ],
  };
}

// ── 1. Fee architecture: on-chain 60/25/15 split ─────────────────────────────

describe("ON_CHAIN_SPLIT: Pump fee sharing pays 60/25/15 directly", () => {
  let f: Awaited<ReturnType<typeof setupFund>>;
  beforeEach(async () => {
    await base();
    f = await setupFund({ mode: "ON_CHAIN_SPLIT" });
  });
  const holders = () => [
    { address: f.fund, shareBps: 6000 },
    { address: f.ecosystem, shareBps: 2500 },
    { address: f.operations, shareBps: 1500 },
  ];

  it("books the fund share as 100% buyback and the other shares as paid directly", async () => {
    const tx = splitDistributeTx({ mint: starlet.mint, distributed: 10n * SOL, holders: holders() });
    h.chain.add(tx);
    const r = await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    expect(r).toMatchObject({ created: 1, warnings: [] });
    const a = await db().revenueAllocation.findFirstOrThrow({ include: { receipt: true } });
    expect(a).toMatchObject({ buybackLamports: 6n * SOL, ecosystemLamports: 2_500_000_000n, operationsLamports: 1_500_000_000n, paidDirect: true });
    expect(a.receipt.lamports).toBe(6n * SOL);
    expect(await pendingBuybackLamports()).toBe(6n * SOL);
    const t = await ledgerTotals();
    expect(t).toMatchObject({ liabilities: 6n * SOL, ecosystemOwed: 0n, operationsOwed: 0n, ecosystemPaidDirect: 2_500_000_000n, operationsPaidDirect: 1_500_000_000n });
    const summary = await getFundSummary();
    expect(summary.totals.creatorFeesLamports).toBe("10000000000");
    expect(summary.treasury.allocationMode).toBe("ON_CHAIN_SPLIT");
    const board = await getPropertyContributions();
    expect(board[0]).toMatchObject({ rank: 1, creatorFeesLamports: "10000000000", buybackAllocatedLamports: "6000000000" });
  });

  it("rejects the receipt when a credited role wallet did not actually receive its share", async () => {
    const tx = splitDistributeTx({ mint: starlet.mint, distributed: 10n * SOL, holders: holders(), arrived: { [f.fund]: 6n * SOL, [f.ecosystem]: 0n, [f.operations]: 1_500_000_000n } });
    h.chain.add(tx);
    await expect(verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN)).rejects.toThrow(/Ecosystem balance rose by 0/);
    expect(await db().feeReceipt.count()).toBe(0);
  });

  it("books what the fund really received but flags a split that differs from 60/25/15", async () => {
    const tx = splitDistributeTx({ mint: starlet.mint, distributed: 10n * SOL, holders: [{ address: f.fund, shareBps: 10_000 }] });
    h.chain.add(tx);
    const r = await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    expect(r.warnings).toEqual([{ reason: "split_mismatch", mint: starlet.mint }]);
    expect(await db().auditLog.count({ where: { action: "fund.receipt_split_mismatch" } })).toBe(1);
  });

  it("ignores fees paid in a non-SOL quote token and duplicate shareholders", async () => {
    const usdc = splitDistributeTx({ mint: starlet.mint, distributed: SOL, holders: holders(), quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" });
    const dup = splitDistributeTx({ mint: ocean.mint, distributed: SOL, holders: [{ address: f.fund, shareBps: 5000 }, { address: f.fund, shareBps: 5000 }] });
    h.chain.add(usdc);
    h.chain.add(dup);
    expect((await verifyAndRecordReceipt(usdc.signature, "MANUAL", ADMIN)).ignored).toEqual([{ reason: "non_sol_quote", mint: starlet.mint }]);
    expect((await verifyAndRecordReceipt(dup.signature, "MANUAL", ADMIN)).ignored).toEqual([{ reason: "duplicate_shareholders", mint: ocean.mint }]);
    expect(await db().feeReceipt.count()).toBe(0);
  });

  it("never lets the fund disburse shares Pump already paid directly", async () => {
    h.chain.add(splitDistributeTx({ mint: starlet.mint, distributed: 10n * SOL, holders: holders() }));
    await verifyAndRecordReceipt([...h.chain.txs.keys()][0]!, "MANUAL", ADMIN);
    const t = { signature: sig(), slot: 1n, blockTime: new Date(), err: null, fee: 5000n, accountKeys: [newKey(), f.fund, f.ecosystem], signers: [], preBalances: [SOL, 10n * SOL, 0n], postBalances: [SOL, 9n * SOL, SOL], preTokenBalances: [], postTokenBalances: [], instructions: [] } as ChainTx;
    h.chain.add(t);
    await expect(recordDisbursement(t.signature, "ECOSYSTEM", ADMIN)).rejects.toThrow(/still held \(0 lamports\)/);
  });
});

// ── 2. Forged events and parser robustness ───────────────────────────────────

describe("forged and malformed fee events", () => {
  let f: Awaited<ReturnType<typeof setupFund>>;
  beforeEach(async () => {
    await base();
    f = await setupFund();
  });

  it("ignores a byte-exact event emitted by a program other than Pump", async () => {
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL });
    tx.instructions = tx.instructions.map((i) => (i.inner ? { ...i, programId: newKey() } : i));
    h.chain.add(tx);
    expect((await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN)).created).toBe(0);
  });

  it("ignores an event placed in a top-level instruction (not an emit_cpi self-call)", async () => {
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL });
    tx.instructions = tx.instructions.map((i) => ({ ...i, inner: false }));
    h.chain.add(tx);
    expect((await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN)).created).toBe(0);
  });

  it("does not book an event whose payout never reached the fund (spoofed amount)", async () => {
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: 100n * SOL, fundDelta: 1n });
    h.chain.add(tx);
    await expect(verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN)).rejects.toMatchObject({ status: 422 });
  });

  it("attributes each event to its own property only (no cross-property attribution)", async () => {
    const a = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL });
    const b = distributeTx({ mint: ocean.mint, fund: f.fund, distributed: 3n * SOL });
    for (const t of [a, b]) h.chain.add(t);
    await verifyAndRecordReceipt(a.signature, "MANUAL", ADMIN);
    await verifyAndRecordReceipt(b.signature, "MANUAL", ADMIN);
    const rows = await db().feeReceipt.findMany({ orderBy: { lamports: "asc" } });
    expect(rows.map((r) => [r.tokenId, r.lamports])).toEqual([[starlet.tokenId, SOL], [ocean.tokenId, 3n * SOL]]);
  });

  it("regression: an RPC outage during a scan does not skip the transaction", async () => {
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL });
    h.chain.add(tx, [f.fund]);
    const realGet = h.chain.getTransaction.bind(h.chain);
    h.chain.getTransaction = async () => {
      throw new Error("RPC outage");
    };
    expect(await scanFundWallet()).toMatchObject({ scanned: 0, created: 0, stoppedEarly: true });
    h.chain.getTransaction = realGet;
    expect(await scanFundWallet()).toMatchObject({ scanned: 1, created: 1 });
  });
});

// ── 3. Token-2022 address correctness ────────────────────────────────────────

describe("token addresses", () => {
  it("derives the same associated token accounts as @solana/spl-token for SPL and Token-2022", () => {
    for (let i = 0; i < 5; i++) {
      const owner = newKey();
      const mint = newKey();
      expect(associatedTokenAddress(owner, mint, PROGRAMS.TOKEN_2022)).toBe(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, TOKEN_2022_PROGRAM_ID).toBase58());
      expect(associatedTokenAddress(owner, mint, PROGRAMS.TOKEN)).toBe(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, TOKEN_PROGRAM_ID).toBase58());
    }
    expect(PROGRAMS.TOKEN_2022).toBe(TOKEN_2022_PROGRAM_ID.toBase58());
  });
});

// ── 4. Multisig registration and the fund guard ──────────────────────────────

describe("multisig registration and fail-closed fund guard", () => {
  beforeEach(async () => {
    await base();
  });

  it("verifies the vault belongs to a real multisig that meets the treasury policy", async () => {
    const ms = h.squads.createMultisig(2, 3);
    const vault = vaultAddress(ms, 0);
    await expect(setWallet("FUND", { address: newKey(), label: "x", isMultisig: true, multisigAddress: ms }, ADMIN)).rejects.toThrow(/not vault 0/);
    await expect(setWallet("FUND", { address: vaultAddress(newKey(), 0), label: "x", isMultisig: true, multisigAddress: newKey() }, ADMIN)).rejects.toThrow();
    const weak = h.squads.createMultisig(1, 2);
    await expect(setWallet("FUND", { address: vaultAddress(weak, 0), label: "x", isMultisig: true, multisigAddress: weak }, ADMIN)).rejects.toThrow(/Threshold 1/);
    h.squads.outage = true;
    await expect(setWallet("FUND", { address: vault, label: "x", isMultisig: true, multisigAddress: ms }, ADMIN)).rejects.toMatchObject({ status: 503 });
    h.squads.outage = false;
    const ok = await setWallet("FUND", { address: vault, label: "Demolition Fund", isMultisig: true, multisigAddress: ms }, ADMIN);
    expect(ok).toMatchObject({ multisigThreshold: 2, multisigMembers: 3, isMultisig: true });
    expect(ok.warnings).toContain("No time lock: approved transactions can execute immediately");
  });

  it("refuses buybacks from a single-signature fund unless explicitly allowed outside production", async () => {
    const f = await setupFund();
    h.chain.add(distributeTx({ mint: starlet.mint, fund: f.fund, distributed: 10n * SOL }));
    await verifyAndRecordReceipt([...h.chain.txs.keys()][0]!, "MANUAL", ADMIN);
    h.chain.balances.set(f.fund, 100n * SOL);
    process.env.FUND_ALLOW_SINGLE_SIG = "false";
    resetConfigForTests();
    await expect(createBuybackRequest({ idempotencyKey: "single-sig-1" }, ADMIN)).rejects.toThrow(/verified Squads multisig/);
    process.env.FUND_ALLOW_SINGLE_SIG = "true";
    resetConfigForTests();
    expect((await createBuybackRequest({ idempotencyKey: "single-sig-2" }, ADMIN)).status).toBe("PLANNED");
  });
});

// ── 5. Full multisig lifecycle ───────────────────────────────────────────────

describe("multisig buyback and burn lifecycle (Squads proposals)", () => {
  let f: Awaited<ReturnType<typeof setupFund>>;
  let ms: string;
  const member = (i: number) => h.squads.members[i]!;

  beforeEach(async () => {
    const mocks = await base();
    f = await setupFund({ multisig: h.squads, mode: "ON_CHAIN_SPLIT" });
    ms = f.multisigAddress!;
    mocks.mints.set(f.dynasty, { ...validMint(), program: "TOKEN_2022" });
    process.env.FUND_ALLOW_SINGLE_SIG = "false"; // production-like: multisig required
    resetConfigForTests();
    h.chain.balances.set(f.fund, 100n * SOL);
    const tx = splitDistributeTx({ mint: starlet.mint, distributed: 10n * SOL, holders: [
      { address: f.fund, shareBps: 6000 },
      { address: f.ecosystem, shareBps: 2500 },
      { address: f.operations, shareBps: 1500 },
    ] });
    h.chain.add(tx);
    await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
  });

  async function approvedRequest(out = 5_000_000n) {
    const r = await createBuybackRequest({ idempotencyKey: `ms-${Math.random().toString(36).slice(2, 12)}` }, ADMIN);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.dynasty, amount: req.amount, out });
    await quoteBuyback(r.id, ADMIN);
    return approveBuyback(r.id, "other-admin", undefined, ADMIN);
  }

  function createAndApprove(p: PreparedProposal) {
    h.squads.memberCreates(p, p.expectedMessage);
    h.squads.approve(ms, p.proposalPda, member(0));
    h.squads.approve(ms, p.proposalPda, member(1));
  }

  it("runs receipt -> plan -> quote -> proposal -> approvals -> execution -> purchase -> burn proposal -> burn", async () => {
    const r = await approvedRequest();
    const swap = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    expect(swap).toMatchObject({ purpose: "SWAP", vault: f.fund, transactionIndex: 1n, threshold: 2 });
    expect(swap.transactionBase64.length).toBeGreaterThan(100);
    expect((await getRequest(r.id)).status).toBe("APPROVED"); // proposing executes nothing

    expect(await syncAllProposals()).toEqual({ PREPARED: 1 }); // not on-chain yet: stays PREPARED
    h.squads.memberCreates(swap, swap.expectedMessage);
    expect(await syncAllProposals()).toEqual({ CREATED: 1 });
    h.squads.approve(ms, swap.proposalPda, member(0));
    expect((await getFundSummary()).pendingActions[0]).toMatchObject({ purpose: "SWAP", status: "CREATED" });
    h.squads.approve(ms, swap.proposalPda, member(1));
    expect(await syncAllProposals()).toEqual({ APPROVED: 1 });
    expect((await getFundSummary()).buybacks[0]?.verification).toBe("AWAITING_EXECUTION");

    h.squads.execute(swap, swapTx({ fund: f.fund, mint: f.dynasty, spent: r.budgetLamports, received: 5_000_000n }));
    expect(await syncAllProposals()).toEqual({ EXECUTED: 1 });
    expect((await getRequest(r.id)).status).toBe("SWAP_SUBMITTED");
    await settleAll();
    expect(await getRequest(r.id)).toMatchObject({ status: "SWAP_CONFIRMED", tokensReceivedRaw: 5_000_000n });

    h.chain.tokens.set(`${f.fund}:${f.dynasty}`, 5_000_000n);
    const burn = await prepareProposal(r.id, "BURN", member(1), ADMIN);
    createAndApprove(burn);
    await syncAllProposals();
    h.squads.execute(burn, burnTx({ fund: f.fund, mint: f.dynasty, amount: 5_000_000n }));
    await syncAllProposals();
    await settleAll();
    expect(await getRequest(r.id)).toMatchObject({ status: "BURNED", tokensBurnedRaw: 5_000_000n });

    const s = await getFundSummary();
    expect(s.pendingActions).toEqual([]);
    expect(s.buybacks[0]).toMatchObject({ verification: "BURN_VERIFIED", dynastyPurchasedRaw: "5000000", dynastyBurnedRaw: "5000000" });
    expect(await db().multisigProposal.count({ where: { status: "EXECUTED" } })).toBe(2);
  });

  it("only members with initiate permission can be proposal creators", async () => {
    const r = await approvedRequest();
    await expect(prepareProposal(r.id, "SWAP", newKey(), ADMIN)).rejects.toThrow(/not a multisig member/);
  });

  it("opens the circuit breaker when the on-chain proposal differs from what was prepared", async () => {
    const r = await approvedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    const tampered = { ...p.expectedMessage, accountKeys: [...p.expectedMessage.accountKeys.slice(0, -1), newKey()] };
    h.squads.memberCreates(p, tampered);
    expect(await syncAllProposals()).toEqual({ MISMATCH: 1 });
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(true);
    await expect(prepareProposal(r.id, "SWAP", member(0), ADMIN)).rejects.toMatchObject({ status: 423 });
  });

  it("marks a proposal stale when its transaction index is used by something else, then allows a fresh one", async () => {
    const r = await approvedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    h.squads.bumpIndex(ms, p.vaultTransactionPda); // a config transaction took index 1
    expect(await syncAllProposals()).toEqual({ STALE: 1 });
    const again = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    expect(again.transactionIndex).toBe(2n);
  });

  it("allows only one live proposal per step (API and database)", async () => {
    const r = await approvedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    h.squads.memberCreates(p, p.expectedMessage);
    await syncAllProposals();
    await expect(prepareProposal(r.id, "SWAP", member(0), ADMIN)).rejects.toMatchObject({ status: 409 });
    const row = await db().multisigProposal.findFirstOrThrow();
    await expect(
      db().multisigProposal.create({ data: { ...row, id: undefined, vaultTransactionPda: newKey(), proposalPda: newKey(), transactionIndex: 99n, executedSignature: null } }),
    ).rejects.toThrow();
  });

  it("rejects a swap that was not executed through this buyback's approved proposal (replay / bypass)", async () => {
    const r = await approvedRequest();
    // Right tokens, right amounts, but executed outside the multisig proposal (e.g. a hot key).
    const rogue = swapTx({ fund: f.fund, mint: f.dynasty, spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(rogue);
    await recordSwapSubmission(r.id, rogue.signature, ADMIN);
    expect(await settleSwap(r.id)).toMatchObject({ status: "APPROVED", failureReason: "Not the execution of this buyback's approved multisig proposal" });
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(true);
  });

  it("rejects replaying another buyback's executed proposal as this buyback's swap", async () => {
    const r1 = await approvedRequest();
    const p1 = await prepareProposal(r1.id, "SWAP", member(0), ADMIN);
    createAndApprove(p1);
    await syncAllProposals();
    const execSig = h.squads.execute(p1, swapTx({ fund: f.fund, mint: f.dynasty, spent: r1.budgetLamports, received: 5_000_000n }));
    await syncAllProposals();
    await settleAll();
    expect((await getRequest(r1.id)).status).toBe("SWAP_CONFIRMED");
    // Fresh request (after burn & cooldown) must not accept the old execution signature.
    await db().buybackRequest.update({ where: { id: r1.id }, data: { status: "BURNED", swapConfirmedAt: new Date(Date.now() - 3_600_000) } });
    const tx2 = splitDistributeTx({ mint: ocean.mint, distributed: 10n * SOL, holders: [{ address: f.fund, shareBps: 6000 }, { address: f.ecosystem, shareBps: 2500 }, { address: f.operations, shareBps: 1500 }] });
    h.chain.add(tx2);
    await verifyAndRecordReceipt(tx2.signature, "MANUAL", ADMIN);
    const r2 = await approvedRequest();
    await expect(recordSwapSubmission(r2.id, execSig, ADMIN)).rejects.toMatchObject({ status: 409 }); // signature already recorded
  });

  it("rejects a burn that was not the execution of the approved burn proposal", async () => {
    const r = await approvedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    createAndApprove(p);
    await syncAllProposals();
    h.squads.execute(p, swapTx({ fund: f.fund, mint: f.dynasty, spent: r.budgetLamports, received: 5_000_000n }));
    await syncAllProposals();
    await settleAll();
    const rogueBurn = burnTx({ fund: f.fund, mint: f.dynasty, amount: 5_000_000n });
    h.chain.add(rogueBurn);
    await recordBurnSubmission(r.id, rogueBurn.signature, ADMIN);
    await settleAll();
    expect(await getRequest(r.id)).toMatchObject({ status: "SWAP_CONFIRMED", tokensBurnedRaw: 0n });
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(true);
  });

  it("keeps an executed-but-unfinalized proposal pending (finality)", async () => {
    const r = await approvedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    createAndApprove(p);
    await syncAllProposals();
    h.squads.proposals.get(p.proposalPda)!.status = "Executed"; // RPC says executed, but no finalized tx yet
    expect(await syncAllProposals()).toEqual({ APPROVED: 1 });
    expect((await getRequest(r.id)).status).toBe("APPROVED");
  });

  it("survives a restart: a new process with fresh dependencies picks up the same state", async () => {
    const r = await approvedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    createAndApprove(p);
    const { chain, squads } = h;
    h = installDemolitionDeps(); // "restart": new dependency container, same database
    Object.assign(h, { chain, squads });
    const { setDemolitionDepsForTests } = await import("@/server/demolition/deps");
    setDemolitionDepsForTests({ chain, swap: h.swap, squads, signer: { publicKey: "", kind: "disabled", signTransaction: async () => { throw new Error("disabled"); } }, now: () => new Date() });
    expect(await syncAllProposals()).toEqual({ APPROVED: 1 });
  });

  it("blocks proposal preparation while paused", async () => {
    const r = await approvedRequest();
    await db().fundConfig.update({ where: { id: 1 }, data: { paused: true, pausedReason: "incident" } });
    await expect(prepareProposal(r.id, "SWAP", member(0), ADMIN)).rejects.toMatchObject({ status: 423 });
  });

  it("refuses a proposal whose Jupiter route includes a non-allowlisted program", async () => {
    const r = await approvedRequest();
    h.swap.next = (req) => {
      const b = jupiterBuild({ fund: f.fund, mint: f.dynasty, amount: req.amount, out: 5_000_000n });
      return { ...b, instructions: { ...b.instructions, other: [{ programId: newKey(), accounts: [{ pubkey: f.fund, isSigner: false, isWritable: true }], data: "" }] } };
    };
    await expect(prepareProposal(r.id, "SWAP", member(0), ADMIN)).rejects.toThrow(/not allowlisted/);
    expect(await db().multisigProposal.count()).toBe(0);
  });

  it("exposes proposals through the admin API with role checks", async () => {
    const r = await approvedRequest();
    await signInAs("EDITOR");
    const denied = await actionRoute(send("POST", `/api/admin/demolition-fund/buybacks/${r.id}/propose-swap`, { creator: member(0) }), params({ id: r.id, action: "propose-swap" }));
    expect(denied.status).toBe(403);
    await signInAs("ADMIN");
    const ok = await actionRoute(send("POST", `/api/admin/demolition-fund/buybacks/${r.id}/propose-swap`, { creator: member(0) }), params({ id: r.id, action: "propose-swap" }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ purpose: "SWAP", transactionIndex: "1", threshold: 2 });
    const list = await (await proposalsRoute(get(`/api/admin/demolition-fund/proposals?buybackId=${r.id}`))).json();
    expect(list.items).toHaveLength(1);
  });
});

// ── 6. Concurrency ───────────────────────────────────────────────────────────

describe("concurrent workers", () => {
  let f: Awaited<ReturnType<typeof setupFund>>;
  beforeEach(async () => {
    await base();
    f = await setupFund();
    h.chain.balances.set(f.fund, 100n * SOL);
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: 10n * SOL });
    h.chain.add(tx);
    await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
  });

  it("creates exactly one buyback when several requests race", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => createBuybackRequest({ idempotencyKey: `race-key-${i}` }, ADMIN)));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await db().buybackRequest.count()).toBe(1);
    expect(await db().buybackFunding.aggregate({ _sum: { lamports: true } })).toMatchObject({ _sum: { lamports: 5n * SOL } });
  });

  it("settles a swap once even when two workers settle concurrently", async () => {
    const r = await createBuybackRequest({ idempotencyKey: "settle-race" }, ADMIN);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.dynasty, amount: req.amount, out: 5_000_000n });
    await quoteBuyback(r.id, ADMIN);
    await approveBuyback(r.id, "approver", undefined, ADMIN);
    const s = swapTx({ fund: f.fund, mint: f.dynasty, spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(s);
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    const results = await Promise.allSettled([settleSwap(r.id), settleSwap(r.id), settleSwap(r.id)]);
    expect(results.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason))).toEqual(["Error: Buyback is not in state SWAP_SUBMITTED", "Error: Buyback is not in state SWAP_SUBMITTED"]);
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    expect(await getRequest(r.id)).toMatchObject({ status: "SWAP_CONFIRMED", solSpentLamports: r.budgetLamports });
    expect(await db().auditLog.count({ where: { action: "buyback.swap_confirmed" } })).toBe(1);
  });

  it("runs one fund pass at a time (transaction-scoped lock) and includes proposal sync and the fee-sharing check", async () => {
    const [x, y] = await Promise.all([fundPass(), fundPass()]);
    expect([x, y].filter((r) => r.ran)).toHaveLength(1);
    expect([x, y].find((r) => !r.ran)).toMatchObject({ reason: "locked" });
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).lastFeeSharingCheckAt).not.toBeNull();
    expect(await fundPass()).toMatchObject({ ran: true }); // the lock is released when a pass ends
  });
});

// ── 7. Fee-sharing configuration checks ──────────────────────────────────────

function encodeSharingConfig(p: { mint: string; admin: string; revoked: boolean; status?: number; holders: { address: string; shareBps: number }[] }) {
  const parts: Buffer[] = [SHARING_CONFIG_DISCRIMINATOR, Buffer.from([255, 1, p.status ?? 1]), new PublicKey(p.mint).toBuffer(), new PublicKey(p.admin).toBuffer(), Buffer.from([p.revoked ? 1 : 0])];
  const n = Buffer.alloc(4);
  n.writeUInt32LE(p.holders.length);
  parts.push(n);
  for (const x of p.holders) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(x.shareBps);
    parts.push(new PublicKey(x.address).toBuffer(), b);
  }
  return Buffer.concat(parts);
}

describe("on-chain fee-sharing configuration checks", () => {
  let f: Awaited<ReturnType<typeof setupFund>>;
  beforeEach(async () => {
    await base();
    f = await setupFund({ mode: "ON_CHAIN_SPLIT" });
  });

  it("passes a locked 60/25/15 config and flags unlocked, wrong or missing configs", async () => {
    const good = [{ address: f.fund, shareBps: 6000 }, { address: f.ecosystem, shareBps: 2500 }, { address: f.operations, shareBps: 1500 }];
    h.chain.accounts.set(sharingConfigAddress(starlet.mint), { owner: PUMP_PROGRAMS.fees, data: encodeSharingConfig({ mint: starlet.mint, admin: newKey(), revoked: true, holders: good }) });
    h.chain.accounts.set(sharingConfigAddress(ocean.mint), {
      owner: PUMP_PROGRAMS.fees,
      data: encodeSharingConfig({ mint: ocean.mint, admin: newKey(), revoked: false, holders: [{ address: newKey(), shareBps: 10_000 }] }),
    });
    expect(await checkFeeSharing()).toEqual({ checked: 2, ok: 1, mismatched: 1 });
    const bad = await db().feeSharingCheck.findUniqueOrThrow({ where: { tokenId: ocean.tokenId } });
    expect(bad.issues.join(" | ")).toMatch(/not locked.*missing shareholder.*unexpected shareholder/);
    const s = await getFundSummary();
    expect(s.feeSharing).toMatchObject({ checked: 2, matching: 1 });
    expect(s.feeSharing.issues[0]).toMatchObject({ ticker: "OCEAN" });

    // A later change to a previously matching config is audited.
    h.chain.accounts.set(sharingConfigAddress(starlet.mint), { owner: PUMP_PROGRAMS.fees, data: encodeSharingConfig({ mint: starlet.mint, admin: newKey(), revoked: true, holders: [{ address: newKey(), shareBps: 10_000 }] }) });
    await checkFeeSharing();
    expect(await db().auditLog.count({ where: { action: "fee_sharing.changed" } })).toBe(1);

    // Missing config (fees would pool per creator, unattributable).
    h.chain.accounts.delete(sharingConfigAddress(starlet.mint));
    await checkFeeSharing();
    expect((await db().feeSharingCheck.findUniqueOrThrow({ where: { tokenId: starlet.tokenId } })).exists).toBe(false);
  });

  it("does not overwrite a previous result when the RPC fails", async () => {
    h.chain.outage = true;
    expect(await checkFeeSharing()).toEqual({ checked: 0, ok: 0, mismatched: 0 });
  });
});

// ── 8. Reconciliation reports balances for the treasury view ──────────────────

describe("treasury transparency", () => {
  it("shows observed balances only after a reconciliation, never invented", async () => {
    await base();
    const f = await setupFund({ mode: "ON_CHAIN_SPLIT" });
    let s = await getFundSummary();
    expect(s.treasury).toMatchObject({ fundBalanceLamports: null, balanceObservedAt: null, liabilitiesLamports: "0" });
    h.chain.balances.set(f.fund, 2n * SOL);
    await reconcile();
    s = await getFundSummary();
    expect(s.treasury).toMatchObject({ fundBalanceLamports: "2000000000", reserveLamports: "50000000" });
    expect(s.treasury.wallets.map((w) => w.role).sort()).toEqual(["ECOSYSTEM", "FUND", "OPERATIONS"]);
  });
});

describe("proposal sync under RPC failure", () => {
  it("regression: a transient RPC error never marks a proposal mismatched or opens the breaker", async () => {
    const mocks = await base();
    const f = await setupFund({ multisig: h.squads, mode: "ON_CHAIN_SPLIT" });
    mocks.mints.set(f.dynasty, { ...validMint(), program: "TOKEN_2022" });
    h.chain.balances.set(f.fund, 100n * SOL);
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: 10n * SOL });
    h.chain.add(tx);
    await updateFundConfig({}, ADMIN).catch(() => {});
    await db().fundConfig.update({ where: { id: 1 }, data: { allocationMode: "FUND_SPLITS" } });
    await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    const r = await createBuybackRequest({ idempotencyKey: "rpc-sync-1" }, ADMIN);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.dynasty, amount: req.amount, out: 5_000_000n });
    await quoteBuyback(r.id, ADMIN);
    await approveBuyback(r.id, "approver", undefined, ADMIN);
    const p = await prepareProposal(r.id, "SWAP", h.squads.members[0]!, ADMIN);
    h.squads.memberCreates(p, p.expectedMessage);
    h.squads.outage = true;
    expect(await syncAllProposals()).toEqual({});
    expect((await db().multisigProposal.findFirstOrThrow()).status).toBe("PREPARED");
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(false);
    await expect(prepareProposal(r.id, "SWAP", h.squads.members[0]!, ADMIN)).rejects.toMatchObject({ status: 503 });
    h.squads.outage = false;
    expect(await syncAllProposals()).toEqual({ CREATED: 1 });
  });
});
