import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";
import { ComputeBudgetProgram, VersionedTransaction } from "@solana/web3.js";
import { resetConfigForTests } from "@/server/config";
import { setSessionResolverForTests } from "@/server/auth/admin";
import { approveBuyback, createBuybackRequest, getRequest, quoteBuyback, settleAll } from "@/server/demolition/buyback";
import { checkFeeSharing, expectedShareholders } from "@/server/demolition/fee-sharing";
import { setWallet } from "@/server/demolition/fund";
import { buildMemberTransaction, fundMultisigStatus, prepareProposal, syncAllProposals } from "@/server/demolition/proposals";
import { encodeDistributeEvent, PUMP_PROGRAMS, sharingConfigAddress } from "@/server/demolition/pump-fees";
import { verifyAndRecordReceipt } from "@/server/demolition/receipts";
import { ledgerTotals } from "@/server/demolition/reconcile";
import { proposalAddress, SQUADS_V4_PROGRAM, transactionAddress, VAULT_TX_EXECUTE_DISCRIMINATOR, vaultAddress } from "@/server/demolition/squads";
import { POST as memberRoute } from "@/app/api/admin/demolition-fund/proposals/[id]/[action]/route";
import { GET as multisigRoute } from "@/app/api/admin/demolition-fund/multisig/route";
import { db, get, installMockProviders, makeLive, newKey, params, resetDatabase, send, signInAs, validMint } from "../helpers/fixtures";
import { installDemolitionDeps, jupiterBuild, setupFund, sig, swapTx, type DemolitionHarness } from "../helpers/demolition";
import type { ChainTx } from "@/server/demolition/chain";

/**
 * One Squads multisig, three vaults: FUND = vault 0, ECOSYSTEM = vault 1, OPERATIONS = vault 2
 * (the owner's chosen setup), and the member signing flow (approve / reject / execute).
 */
const ADMIN = { id: "admin-1", label: "test-admin" };
const SOL = 1_000_000_000n;

let h: DemolitionHarness;
let starlet: { tokenId: string; mint: string };
let ms: string;
let vaults: { fund: string; ecosystem: string; operations: string; dynasty: string };
const member = (i: number) => h.squads.members[i]!;

function distribute(mint: string, distributed: bigint, holders: { address: string; shareBps: number }[]): ChainTx {
  const cranker = newKey();
  const keys = [cranker, ...holders.map((x) => x.address)];
  return {
    signature: sig(),
    slot: 77n,
    blockTime: new Date(),
    err: null,
    fee: 5_000n,
    accountKeys: keys,
    signers: [cranker],
    preBalances: keys.map(() => 1_000_000n),
    postBalances: keys.map((k, i) => (i === 0 ? 995_000n : 1_000_000n + (distributed * BigInt(holders.find((x) => x.address === k)!.shareBps)) / 10_000n)),
    preTokenBalances: [],
    postTokenBalances: [],
    instructions: [
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(Buffer.from([255, 203, 19, 79, 244, 68, 8, 159, 0])), parsed: null, accounts: [], inner: false },
      {
        programId: PUMP_PROGRAMS.pump,
        data: bs58.encode(encodeDistributeEvent({ mint, sharingConfig: sharingConfigAddress(mint), shareholders: holders, distributed, quoteMint: "11111111111111111111111111111111" })),
        parsed: null,
        accounts: [],
        inner: true,
      },
    ],
  };
}

beforeEach(async () => {
  await resetDatabase();
  const mocks = installMockProviders();
  h = installDemolitionDeps();
  starlet = await makeLive("starlet-motel");
  const f = await setupFund({ multisig: h.squads, mode: "ON_CHAIN_SPLIT" });
  ms = f.multisigAddress!;
  mocks.mints.set(f.dynasty, { ...validMint(), program: "TOKEN_2022" });
  // Re-register ECOSYSTEM and OPERATIONS as vaults 1 and 2 of the same multisig.
  await db().treasuryWallet.deleteMany({ where: { role: { in: ["ECOSYSTEM", "OPERATIONS"] } } });
  await setWallet("ECOSYSTEM", { address: vaultAddress(ms, 1), label: "Ecosystem (vault 1)", isMultisig: true, multisigAddress: ms, vaultIndex: 1 }, ADMIN);
  await setWallet("OPERATIONS", { address: vaultAddress(ms, 2), label: "Operations (vault 2)", isMultisig: true, multisigAddress: ms, vaultIndex: 2 }, ADMIN);
  vaults = { fund: f.fund, ecosystem: vaultAddress(ms, 1), operations: vaultAddress(ms, 2), dynasty: f.dynasty };
  process.env.FUND_ALLOW_SINGLE_SIG = "false";
  resetConfigForTests();
  h.chain.balances.set(f.fund, 100n * SOL);
});

afterEach(() => {
  setSessionResolverForTests(null);
  process.env.FUND_ALLOW_SINGLE_SIG = "true";
  resetConfigForTests();
});

const split = () => [
  { address: vaults.fund, shareBps: 6000 },
  { address: vaults.ecosystem, shareBps: 2500 },
  { address: vaults.operations, shareBps: 1500 },
];

async function fundedApprovedRequest() {
  const tx = distribute(starlet.mint, 10n * SOL, split());
  h.chain.add(tx);
  await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
  const r = await createBuybackRequest({ idempotencyKey: `sig-${Math.random().toString(36).slice(2, 12)}` }, ADMIN);
  h.swap.next = (req) => jupiterBuild({ fund: vaults.fund, mint: vaults.dynasty, amount: req.amount, out: 5_000_000n });
  await quoteBuyback(r.id, ADMIN);
  return approveBuyback(r.id, "other-admin", undefined, ADMIN);
}

async function createdProposal() {
  const r = await fundedApprovedRequest();
  const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
  h.squads.memberCreates(p, p.expectedMessage);
  await syncAllProposals();
  return { r, p };
}

describe("one multisig, three vaults (FUND 0 / ECOSYSTEM 1 / OPERATIONS 2)", () => {
  it("registers each vault, books the 60/25/15 split and expects the three vaults as Pump shareholders", async () => {
    const wallets = await db().treasuryWallet.findMany({ orderBy: { vaultIndex: "asc" } });
    expect(wallets.map((w) => [w.role, w.vaultIndex, w.multisigAddress])).toEqual([
      ["FUND", 0, ms],
      ["ECOSYSTEM", 1, ms],
      ["OPERATIONS", 2, ms],
    ]);
    // A vault index that does not match the address is refused.
    await expect(setWallet("OPERATIONS", { address: vaultAddress(ms, 2), label: "x", isMultisig: true, multisigAddress: ms, vaultIndex: 1 }, ADMIN)).rejects.toThrow(/not vault 1/);

    const tx = distribute(starlet.mint, 10n * SOL, split());
    h.chain.add(tx);
    await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    const t = await ledgerTotals();
    expect(t.buybackAllocated).toBe(6n * SOL);
    expect(t.ecosystemPaidDirect).toBe(2_500_000_000n);
    expect(t.operationsPaidDirect).toBe(1_500_000_000n);
    expect(t.ecosystemOwed + t.operationsOwed).toBe(0n);

    expect((await expectedShareholders())?.holders).toEqual(split());
    await checkFeeSharing();
  });

  it("a transaction for another vault of the same multisig makes a prepared fund proposal stale, never mismatched", async () => {
    const r = await fundedApprovedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    h.squads.bumpIndex(ms, p.vaultTransactionPda); // e.g. an ecosystem payment proposal took the index
    expect(await syncAllProposals()).toEqual({ STALE: 1 });
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(false);
    expect((await prepareProposal(r.id, "SWAP", member(0), ADMIN)).transactionIndex).toBe(2n);
  });

  it("reports the live multisig and the connected wallet's permissions", async () => {
    const s = await fundMultisigStatus(member(1));
    expect(s.multisig).toMatchObject({ threshold: 2 });
    expect(s.multisig!.vaults.map((v) => v.index).sort()).toEqual([0, 1, 2]);
    expect(s.connected).toMatchObject({ isMember: true, permissions: { vote: true, execute: true } });
    expect((await fundMultisigStatus(newKey())).connected).toMatchObject({ isMember: false });
  });
});

describe("member signing transactions (approve / reject / execute)", () => {
  it("builds an unsigned approve transaction paid and signed only by the member", async () => {
    const { p } = await createdProposal();
    const row = await db().multisigProposal.findFirstOrThrow();
    const t = await buildMemberTransaction(row.id, "approve", member(0), ADMIN);
    const tx = VersionedTransaction.deserialize(Buffer.from(t.transactionBase64, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys[0]).toBe(member(0)); // fee payer
    expect(tx.message.header.numRequiredSignatures).toBe(1); // nobody else signs
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true); // unsigned
    const ix = tx.message.compiledInstructions[0]!;
    expect(keys[ix.programIdIndex]).toBe(SQUADS_V4_PROGRAM);
    expect(Buffer.from(ix.data.subarray(0, 8))).toEqual(Buffer.from(multisig.generated.proposalApproveInstructionDiscriminator));
    expect(ix.accountKeyIndexes.map((i) => keys[i])).toContain(p.proposalPda);
    expect(t).toMatchObject({ action: "approve", approvals: 0, threshold: 2 });
  });

  it("refuses non-members, double votes, votes before creation and execution before approval", async () => {
    const r = await fundedApprovedRequest();
    const prepared = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    const row = await db().multisigProposal.findFirstOrThrow();
    await expect(buildMemberTransaction(row.id, "approve", member(0), ADMIN)).rejects.toMatchObject({ status: 409 }); // not on-chain yet
    h.squads.memberCreates(prepared, prepared.expectedMessage);
    await expect(buildMemberTransaction(row.id, "approve", newKey(), ADMIN)).rejects.toMatchObject({ status: 403 });
    await expect(buildMemberTransaction(row.id, "execute", member(0), ADMIN)).rejects.toThrow(/not approved yet \(0 of 2/);
    h.squads.approve(ms, prepared.proposalPda, member(0));
    await expect(buildMemberTransaction(row.id, "approve", member(0), ADMIN)).rejects.toThrow(/already voted/);
    await expect(buildMemberTransaction(row.id, "execute", member(1), ADMIN)).rejects.toThrow(/1 of 2/); // one approval is not enough
  });

  it("builds an execute transaction only after the threshold, with the exact proposal accounts", async () => {
    const { r, p } = await createdProposal();
    const row = await db().multisigProposal.findFirstOrThrow();
    h.squads.approve(ms, p.proposalPda, member(0));
    h.squads.approve(ms, p.proposalPda, member(1));
    const t = await buildMemberTransaction(row.id, "execute", member(2), ADMIN);
    const tx = VersionedTransaction.deserialize(Buffer.from(t.transactionBase64, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys[0]).toBe(member(2));
    const [cu, exec] = tx.message.compiledInstructions;
    expect(keys[cu!.programIdIndex]).toBe(ComputeBudgetProgram.programId.toBase58());
    expect(Buffer.from(exec!.data.subarray(0, 8))).toEqual(VAULT_TX_EXECUTE_DISCRIMINATOR);
    expect(exec!.accountKeyIndexes.slice(0, 3).map((i) => keys[i])).toEqual([ms, proposalAddress(ms, 1n), transactionAddress(ms, 1n)]);
    expect((await getRequest(r.id)).status).toBe("APPROVED"); // building executes nothing

    // The member's wallet sends it; the worker binds the execution and settles the purchase.
    h.squads.execute(p, swapTx({ fund: vaults.fund, mint: vaults.dynasty, spent: r.budgetLamports, received: 5_000_000n }), member(2));
    expect(await syncAllProposals()).toEqual({ EXECUTED: 1 });
    await settleAll();
    expect(await getRequest(r.id)).toMatchObject({ status: "SWAP_CONFIRMED", tokensReceivedRaw: 5_000_000n });
  });

  it("refuses to build an execute while paused or with the breaker open", async () => {
    const { p } = await createdProposal();
    const row = await db().multisigProposal.findFirstOrThrow();
    h.squads.approve(ms, p.proposalPda, member(0));
    h.squads.approve(ms, p.proposalPda, member(1));
    await db().fundConfig.update({ where: { id: 1 }, data: { paused: true, pausedReason: "review" } });
    await expect(buildMemberTransaction(row.id, "execute", member(0), ADMIN)).rejects.toMatchObject({ status: 423 });
    await db().fundConfig.update({ where: { id: 1 }, data: { paused: false, pausedReason: null, circuitOpen: true, circuitReason: "test" } });
    await expect(buildMemberTransaction(row.id, "execute", member(0), ADMIN)).rejects.toMatchObject({ status: 423 });
  });

  it("re-verifies the on-chain message before building any member transaction", async () => {
    const r = await fundedApprovedRequest();
    const p = await prepareProposal(r.id, "SWAP", member(0), ADMIN);
    const row = await db().multisigProposal.findFirstOrThrow();
    h.squads.memberCreates(p, { ...p.expectedMessage, accountKeys: [...p.expectedMessage.accountKeys.slice(0, -1), newKey()] });
    await expect(buildMemberTransaction(row.id, "approve", member(1), ADMIN)).rejects.toThrow(/does not match/);
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(true);
  });

  it("returns 503 and changes nothing when Solana cannot be read", async () => {
    const { p } = await createdProposal();
    const row = await db().multisigProposal.findFirstOrThrow();
    h.squads.approve(ms, p.proposalPda, member(0));
    h.squads.outage = true;
    await expect(buildMemberTransaction(row.id, "approve", member(1), ADMIN)).rejects.toMatchObject({ status: 503 });
    h.squads.outage = false;
    expect((await db().multisigProposal.findFirstOrThrow()).status).toBe("CREATED");
  });

  it("builds a reject vote", async () => {
    const { p } = await createdProposal();
    const row = await db().multisigProposal.findFirstOrThrow();
    const t = await buildMemberTransaction(row.id, "reject", member(1), ADMIN);
    const tx = VersionedTransaction.deserialize(Buffer.from(t.transactionBase64, "base64"));
    expect(Buffer.from(tx.message.compiledInstructions[0]!.data.subarray(0, 8))).toEqual(Buffer.from(multisig.generated.proposalRejectInstructionDiscriminator));
    expect(p.proposalPda).toBeTruthy();
  });

  it("enforces admin roles on the signing endpoints", async () => {
    await createdProposal();
    const row = await db().multisigProposal.findFirstOrThrow();
    await signInAs("EDITOR");
    const url = `/api/admin/demolition-fund/proposals/${row.id}/approve`;
    expect((await memberRoute(send("POST", url, { member: member(0) }), params({ id: row.id, action: "approve" }))).status).toBe(403);
    expect((await multisigRoute(get(`/api/admin/demolition-fund/multisig?member=${member(0)}`))).status).toBe(200); // VIEWER+ can read
    await signInAs("ADMIN");
    const ok = await memberRoute(send("POST", url, { member: member(0) }), params({ id: row.id, action: "approve" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ action: "approve", transactionIndex: "1" });
    expect((await memberRoute(send("POST", url.replace("approve", "sign"), { member: member(0) }), params({ id: row.id, action: "sign" }))).status).toBe(404);
  });
});
