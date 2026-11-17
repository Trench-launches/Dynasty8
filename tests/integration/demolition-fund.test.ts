import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "@/server/http/fetch-json";
import { setSessionResolverForTests } from "@/server/auth/admin";
import {
  approveBuyback,
  burnProposal,
  cancelBuyback,
  createBuybackRequest,
  getRequest,
  pendingBuybackLamports,
  quoteBuyback,
  recordBurnSubmission,
  recordSwapSubmission,
  settleAll,
  settleBurn,
  settleSwap,
  swapProposal,
} from "@/server/demolition/buyback";
import { runExecutor } from "@/server/demolition/executor";
import { setPaused, updateFundConfig } from "@/server/demolition/fund";
import { scanFundWallet, verifyAndRecordReceipt } from "@/server/demolition/receipts";
import { reconcile, recordDisbursement } from "@/server/demolition/reconcile";
import { SYSTEM_ACTOR } from "@/server/services/audit";
import { POST as buybacksRoute } from "@/app/api/admin/demolition-fund/buybacks/route";
import { POST as actionRoute } from "@/app/api/admin/demolition-fund/buybacks/[id]/[action]/route";
import { POST as receiptsRoute } from "@/app/api/admin/demolition-fund/receipts/route";
import { PATCH as configRoute } from "@/app/api/admin/demolition-fund/config/route";
import { POST as pauseRoute } from "@/app/api/admin/demolition-fund/pause/route";
import { GET as summaryRoute } from "@/app/api/demolition-fund/summary/route";
import { GET as propertiesRoute } from "@/app/api/demolition-fund/properties/route";
import { GET as burnsRoute } from "@/app/api/demolition-fund/burns/route";
import { GET as historyRoute } from "@/app/api/demolition-fund/history/route";
import { GET as txRoute } from "@/app/api/demolition-fund/transactions/[signature]/route";
import { db, get, installMockProviders, makeLive, newKey, params, resetDatabase, send, signInAs, validMint, type MockState } from "../helpers/fixtures";
import {
  burnTx,
  distributeTx,
  FakeSender,
  installDemolitionDeps,
  jupiterBuild,
  setupFund,
  sig,
  swapTx,
  testSigner,
  transferTx,
  type DemolitionHarness,
} from "../helpers/demolition";

const ADMIN = { id: "admin-1", label: "test-admin" };
const OTHER_ADMIN = "admin-2";
const SOL = 1_000_000_000n;

let h: DemolitionHarness;
let mocks: MockState;
let f: Awaited<ReturnType<typeof setupFund>>;
let starlet: { tokenId: string; mint: string };
let ocean: { tokenId: string; mint: string };

beforeEach(async () => {
  await resetDatabase();
  mocks = installMockProviders();
  h = installDemolitionDeps();
  f = await setupFund();
  starlet = await makeLive("starlet-motel");
  ocean = await makeLive("ocean-view-hotel");
  h.chain.balances.set(f.fund, 100n * SOL);
  mocks.mints.set(f.realty, { ...validMint(), program: "TOKEN_2022" });
});
afterEach(() => setSessionResolverForTests(null));

/** Records a verified receipt of `lamports` (100% share) from a property. */
async function receive(mint: string, lamports: bigint) {
  const tx = distributeTx({ mint, fund: f.fund, distributed: lamports });
  h.chain.add(tx, [f.fund]);
  return { tx, result: await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN) };
}

/** Drives a buyback to APPROVED with a good quote. */
async function approved(budget?: bigint, out = 5_000_000n) {
  const r = await createBuybackRequest({ idempotencyKey: `key-${Math.random().toString(36).slice(2, 12)}`, budgetLamports: budget }, ADMIN);
  h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount, out });
  await quoteBuyback(r.id, ADMIN);
  return approveBuyback(r.id, OTHER_ADMIN, undefined, ADMIN);
}

describe("revenue receipts", () => {
  it("verifies a Pump distribute transaction and allocates 60/25/15 exactly", async () => {
    const { result } = await receive(starlet.mint, 10n * SOL);
    expect(result).toMatchObject({ created: 1, duplicates: 0 });
    const r = await db().feeReceipt.findFirstOrThrow({ include: { allocation: true } });
    expect(r).toMatchObject({ lamports: 10n * SOL, mint: starlet.mint, source: "MANUAL", tokenId: starlet.tokenId });
    expect(r.allocation).toMatchObject({ buybackLamports: 6n * SOL, ecosystemLamports: 2_500_000_000n, operationsLamports: 1_500_000_000n });
    expect(await pendingBuybackLamports()).toBe(6n * SOL);
  });

  it("credits only the fund's share when fees are shared", async () => {
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: 10n * SOL, shareBps: 5_000, otherHolders: [{ address: newKey(), shareBps: 5_000 }] });
    h.chain.add(tx);
    await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    expect((await db().feeReceipt.findFirstOrThrow()).lamports).toBe(5n * SOL);
  });

  it("never double-counts a transaction observed twice (manual + scan)", async () => {
    const { tx } = await receive(starlet.mint, SOL);
    const again = await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    expect(again).toMatchObject({ created: 0, duplicates: 1 });
    expect(await scanFundWallet()).toMatchObject({ created: 0 });
    expect(await db().feeReceipt.count()).toBe(1);
    expect(await db().revenueAllocation.count()).toBe(1);
  });

  it("ignores unregistered mints, impostor sharing configs and payouts to other wallets", async () => {
    const unregistered = distributeTx({ mint: newKey(), fund: f.fund, distributed: SOL });
    const impostor = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL, sharingConfig: newKey() });
    const elsewhere = distributeTx({ mint: starlet.mint, fund: newKey(), distributed: SOL });
    for (const t of [unregistered, impostor, elsewhere]) h.chain.add(t);
    expect((await verifyAndRecordReceipt(unregistered.signature, "MANUAL", ADMIN)).ignored[0]?.reason).toBe("unregistered_mint");
    expect((await verifyAndRecordReceipt(impostor.signature, "MANUAL", ADMIN)).ignored[0]?.reason).toBe("sharing_config_mismatch");
    expect((await verifyAndRecordReceipt(elsewhere.signature, "MANUAL", ADMIN)).ignored[0]?.reason).toBe("fund_not_shareholder");
    expect(await db().feeReceipt.count()).toBe(0);
  });

  it("rejects receipts whose money did not actually arrive, failed transactions and unknown signatures", async () => {
    const fake = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: 5n * SOL, fundDelta: SOL });
    const failed = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL, err: { InstructionError: [0, "Custom"] } });
    h.chain.add(fake);
    h.chain.add(failed);
    await expect(verifyAndRecordReceipt(fake.signature, "MANUAL", ADMIN)).rejects.toMatchObject({ status: 422 });
    await expect(verifyAndRecordReceipt(failed.signature, "MANUAL", ADMIN)).rejects.toMatchObject({ status: 422 });
    await expect(verifyAndRecordReceipt(sig(), "MANUAL", ADMIN)).rejects.toMatchObject({ status: 422 });
    expect(await db().feeReceipt.count()).toBe(0);
  });

  it("reports an RPC outage as 503 without booking anything", async () => {
    const tx = distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL });
    h.chain.add(tx);
    h.chain.outage = true;
    await expect(verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN)).rejects.toMatchObject({ status: 503 });
    expect(await db().feeReceipt.count()).toBe(0);
  });

  it("scans the fund wallet with a resumable cursor", async () => {
    for (let i = 0; i < 3; i++) h.chain.add(distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL }), [f.fund]);
    expect(await scanFundWallet(10, 2)).toMatchObject({ scanned: 3, created: 3 });
    h.chain.add(distributeTx({ mint: ocean.mint, fund: f.fund, distributed: 2n * SOL }), [f.fund]);
    expect(await scanFundWallet()).toMatchObject({ scanned: 1, created: 1 });
    expect(await scanFundWallet()).toMatchObject({ scanned: 0, created: 0 });
  });
});

describe("buyback planning and safety controls", () => {
  it("is idempotent and allows one active buyback at a time", async () => {
    await receive(starlet.mint, 10n * SOL);
    const a = await createBuybackRequest({ idempotencyKey: "same-key-1" }, ADMIN);
    const b = await createBuybackRequest({ idempotencyKey: "same-key-1" }, ADMIN);
    expect(b.id).toBe(a.id);
    await expect(createBuybackRequest({ idempotencyKey: "other-key-2" }, ADMIN)).rejects.toMatchObject({ status: 409 });
    expect(await db().buybackRequest.count()).toBe(1);
  });

  it("budgets only verified revenue and traces it to receipts", async () => {
    await expect(createBuybackRequest({ idempotencyKey: "nothing-yet" }, ADMIN)).rejects.toMatchObject({ status: 422 });
    await receive(starlet.mint, 2n * SOL);
    await receive(ocean.mint, 3n * SOL);
    const r = await createBuybackRequest({ idempotencyKey: "fund-trace" }, ADMIN);
    expect(r.budgetLamports).toBe(3n * SOL); // 60% of 5 SOL
    const fundings = await db().buybackFunding.findMany({ include: { allocation: { include: { receipt: true } } } });
    expect(fundings.map((x) => [x.allocation.receipt.mint, x.lamports])).toEqual([
      [starlet.mint, 1_200_000_000n],
      [ocean.mint, 1_800_000_000n],
    ]);
    expect(await pendingBuybackLamports()).toBe(0n);
  });

  it("enforces per-transaction and daily caps", async () => {
    await updateFundConfig({ maxBuybackLamportsPerTx: 2n * SOL, maxDailyBuybackLamports: 3n * SOL }, ADMIN);
    await receive(starlet.mint, 20n * SOL);
    const first = await createBuybackRequest({ idempotencyKey: "cap-one-1" }, ADMIN);
    expect(first.budgetLamports).toBe(2n * SOL);
    await cancelBuyback(first.id, "test cancel", ADMIN);
    await db().buybackRequest.update({ where: { id: first.id }, data: { status: "BURNED" } }); // count it toward today's spend
    const second = await createBuybackRequest({ idempotencyKey: "cap-two-2" }, ADMIN);
    expect(second.budgetLamports).toBe(1n * SOL);
  });

  it("refuses when the fund lacks SOL after its reserve", async () => {
    await receive(starlet.mint, 10n * SOL);
    h.chain.balances.set(f.fund, 50_000_000n); // exactly the reserve
    await expect(createBuybackRequest({ idempotencyKey: "no-sol-1" }, ADMIN)).rejects.toThrow(/Insufficient SOL/);
  });

  it("enforces the cooldown between buybacks", async () => {
    await updateFundConfig({ cooldownSeconds: 3600 }, ADMIN);
    await receive(starlet.mint, 20n * SOL);
    const r = await createBuybackRequest({ idempotencyKey: "cool-1" }, ADMIN);
    await db().buybackRequest.update({ where: { id: r.id }, data: { status: "BURNED", swapConfirmedAt: new Date() } });
    await expect(createBuybackRequest({ idempotencyKey: "cool-2" }, ADMIN)).rejects.toMatchObject({ status: 429 });
  });

  it("emergency pause blocks new actions but still lets executed transactions be verified", async () => {
    await receive(starlet.mint, 10n * SOL);
    const r = await approved();
    await recordSwapSubmission(r.id, (h.chain.add(swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n })), [...h.chain.txs.keys()].pop()!), ADMIN);
    await setPaused(true, "incident", ADMIN);
    await expect(createBuybackRequest({ idempotencyKey: "paused-1" }, ADMIN)).rejects.toMatchObject({ status: 423 });
    await expect(swapProposal(r.id)).rejects.toMatchObject({ status: 423 });
    expect((await settleSwap(r.id)).status).toBe("SWAP_CONFIRMED");
  });
});

describe("quotes, liquidity, slippage, providers", () => {
  beforeEach(async () => {
    await receive(starlet.mint, 10n * SOL);
  });

  it("rejects insufficient or stale liquidity", async () => {
    const r = await createBuybackRequest({ idempotencyKey: "liq-1" }, ADMIN);
    await db().marketSnapshot.create({ data: { tokenId: f.nativeId, source: "test", liquidityUsd: 500 } });
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount });
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toThrow(/Liquidity below/);
    await db().marketSnapshot.deleteMany();
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toThrow(/No fresh liquidity/);
    expect(h.swap.calls).toBe(0);
  });

  it("rejects excessive price impact and slippage, wrong mints and unknown programs", async () => {
    const r = await createBuybackRequest({ idempotencyKey: "pol-1" }, ADMIN);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount, impactBps: 900 });
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toThrow(/Price impact/);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount, slippageBps: 900 });
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toThrow(/Slippage/);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: newKey(), amount: req.amount });
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toThrow(/not the target/);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount }, { instructions: { ...jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount }).instructions, swap: { programId: newKey(), accounts: [], data: "" } } });
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toThrow(/not allowlisted/);
    expect((await getRequest(r.id)).status).toBe("PLANNED");
  });

  it("maps provider timeouts and rate limits to 503 without changing state", async () => {
    const r = await createBuybackRequest({ idempotencyKey: "prov-1" }, ADMIN);
    h.swap.error = new ProviderError("t", "timeout");
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toMatchObject({ status: 503 });
    h.swap.error = new ProviderError("429", "rate_limited");
    await expect(quoteBuyback(r.id, ADMIN)).rejects.toMatchObject({ status: 503 });
    expect((await getRequest(r.id)).status).toBe("PLANNED");
  });

  it("requires a fresh quote and enough approvals, and blocks executing a worse price than approved", async () => {
    await updateFundConfig({ requiredApprovals: 2 }, ADMIN);
    const r = await createBuybackRequest({ idempotencyKey: "appr-1" }, ADMIN);
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount, out: 5_000_000n });
    await quoteBuyback(r.id, ADMIN);
    expect((await approveBuyback(r.id, "approver-a", undefined, ADMIN)).status).toBe("QUOTED");
    await expect(approveBuyback(r.id, "approver-a", undefined, ADMIN)).rejects.toMatchObject({ status: 409 });
    expect((await approveBuyback(r.id, "approver-b", undefined, ADMIN)).status).toBe("APPROVED");
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount, out: 4_000_000n });
    await expect(swapProposal(r.id)).rejects.toThrow(/below the approved minimum/);

    const r2 = await db().buybackRequest.create({ data: { idempotencyKey: "stale-q", targetMint: f.realty, budgetLamports: SOL, slippageBps: 100, status: "QUOTED", quotedAt: new Date(Date.now() - 11 * 60_000) } });
    await expect(approveBuyback(r2.id, "approver-a", undefined, ADMIN)).rejects.toThrow(/older than 10 minutes/);
  });
});

describe("swap and burn execution (multisig flow)", () => {
  beforeEach(async () => {
    await receive(starlet.mint, 10n * SOL);
  });

  it("completes the full flow and records every signature", async () => {
    const r = await approved();
    const proposal = await swapProposal(r.id);
    expect(proposal.build.inAmount).toBe(r.budgetLamports);
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    expect((await settleSwap(r.id)).status).toBe("SWAP_SUBMITTED"); // not finalized yet: submitted != confirmed
    h.chain.add(s);
    const confirmed = await settleSwap(r.id);
    expect(confirmed).toMatchObject({ status: "SWAP_CONFIRMED", tokensReceivedRaw: 5_000_000n, solSpentLamports: r.budgetLamports });

    h.chain.tokens.set(`${f.fund}:${f.realty}`, 5_000_000n);
    const bp = await burnProposal(r.id);
    expect(bp.amount).toBe(5_000_000n);
    const b = burnTx({ fund: f.fund, mint: f.realty, amount: 5_000_000n });
    await recordBurnSubmission(r.id, b.signature, ADMIN);
    h.chain.add(b);
    const burned = await settleBurn(r.id);
    expect(burned).toMatchObject({ status: "BURNED", tokensBurnedRaw: 5_000_000n });
    const txs = await db().chainTransaction.findMany({ orderBy: { submittedAt: "asc" } });
    expect(txs.map((t) => [t.purpose, t.status])).toEqual([["SWAP", "FINALIZED"], ["BURN", "FINALIZED"]]);
  });

  it("returns a failed swap to APPROVED without spending, and trips the breaker after repeated failures", async () => {
    const r = await approved();
    for (let i = 0; i < 3; i++) {
      const s = swapTx({ fund: f.fund, mint: f.realty, spent: 0n, received: 0n, err: { InstructionError: [2, { Custom: 6001 }] } });
      h.chain.add(s);
      await recordSwapSubmission(r.id, s.signature, ADMIN);
      expect((await settleSwap(r.id)).status).toBe("APPROVED");
    }
    const cfg = await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(cfg).toMatchObject({ circuitOpen: true, consecutiveFailures: 3 });
    await expect(swapProposal(r.id)).rejects.toMatchObject({ status: 423 });
  });

  it("opens the breaker when a submitted signature does not match the approved swap", async () => {
    const r = await approved();
    const wrong = swapTx({ fund: f.fund, mint: newKey(), spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(wrong);
    await recordSwapSubmission(r.id, wrong.signature, ADMIN);
    expect((await settleSwap(r.id)).status).toBe("APPROVED");
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(true);
  });

  it("rejects reusing a signature for a second request", async () => {
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    await expect(recordSwapSubmission(r.id, s.signature, ADMIN)).rejects.toMatchObject({ status: 409 });
  });

  it("handles confirmation delays and expiry by block height", async () => {
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    await recordSwapSubmission(r.id, s.signature, ADMIN, 1_500n);
    h.chain.states.set(s.signature, { status: "confirmed", err: null });
    expect((await settleSwap(r.id)).status).toBe("SWAP_SUBMITTED"); // confirmed but not finalized
    h.chain.states.delete(s.signature);
    h.chain.height = 1_400n;
    expect((await settleSwap(r.id)).status).toBe("SWAP_SUBMITTED"); // could still land
    h.chain.height = 1_600n;
    const after = await settleSwap(r.id);
    expect(after).toMatchObject({ status: "APPROVED", failureReason: "Swap transaction expired" });
    expect((await db().chainTransaction.findUniqueOrThrow({ where: { signature: s.signature } })).status).toBe("EXPIRED");
  });

  it("keeps purchased tokens and retries only the burn when a burn fails (no second swap)", async () => {
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(s);
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    await settleSwap(r.id);
    h.chain.tokens.set(`${f.fund}:${f.realty}`, 5_000_000n);
    const swapsBefore = h.swap.calls;

    const bad = burnTx({ fund: f.fund, mint: f.realty, amount: 5_000_000n, err: { InstructionError: [0, "InsufficientFunds"] } });
    h.chain.add(bad);
    await recordBurnSubmission(r.id, bad.signature, ADMIN);
    const back = await settleBurn(r.id);
    expect(back).toMatchObject({ status: "SWAP_CONFIRMED", tokensReceivedRaw: 5_000_000n, tokensBurnedRaw: 0n });
    await expect(swapProposal(r.id)).rejects.toMatchObject({ status: 409 }); // cannot buy again

    const good = burnTx({ fund: f.fund, mint: f.realty, amount: 5_000_000n });
    h.chain.add(good);
    await recordBurnSubmission(r.id, good.signature, ADMIN);
    expect((await settleBurn(r.id)).status).toBe("BURNED");
    expect(h.swap.calls).toBe(swapsBefore);
    expect(await db().buybackRequest.count({ where: { swapSignature: { not: null } } })).toBe(1);
  });

  it("handles partial burns and refuses burns that do not match", async () => {
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(s);
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    await settleSwap(r.id);
    h.chain.tokens.set(`${f.fund}:${f.realty}`, 5_000_000n);

    const part = burnTx({ fund: f.fund, mint: f.realty, amount: 2_000_000n, balanceBefore: 5_000_000n });
    h.chain.add(part);
    await recordBurnSubmission(r.id, part.signature, ADMIN);
    expect(await settleBurn(r.id)).toMatchObject({ status: "SWAP_CONFIRMED", tokensBurnedRaw: 2_000_000n });
    h.chain.tokens.set(`${f.fund}:${f.realty}`, 3_000_000n);
    expect((await burnProposal(r.id)).amount).toBe(3_000_000n);

    const wrongAuthority = burnTx({ fund: f.fund, mint: f.realty, amount: 3_000_000n, authority: newKey() });
    h.chain.add(wrongAuthority);
    await recordBurnSubmission(r.id, wrongAuthority.signature, ADMIN);
    expect(await settleBurn(r.id)).toMatchObject({ status: "SWAP_CONFIRMED", tokensBurnedRaw: 2_000_000n });

    const tooMuch = burnTx({ fund: f.fund, mint: f.realty, amount: 9_000_000n });
    h.chain.add(tooMuch);
    await recordBurnSubmission(r.id, tooMuch.signature, ADMIN);
    expect((await settleBurn(r.id)).failureReason).toMatch(/exceeds purchased/);

    const rest = burnTx({ fund: f.fund, mint: f.realty, amount: 3_000_000n });
    h.chain.add(rest);
    await recordBurnSubmission(r.id, rest.signature, ADMIN);
    expect(await settleBurn(r.id)).toMatchObject({ status: "BURNED", tokensBurnedRaw: 5_000_000n });
  });

  it("refuses to propose a burn when the fund holds fewer tokens than purchased (invalid token account)", async () => {
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(s);
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    await settleSwap(r.id);
    h.chain.tokens.set(`${f.fund}:${f.realty}`, 1_000n);
    await expect(burnProposal(r.id)).rejects.toThrow(/fewer tokens/);
  });

  it("leaves state untouched during an RPC outage while settling", async () => {
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    h.chain.outage = true;
    await expect(settleAll()).rejects.toThrow(/RPC outage/);
    h.chain.outage = false;
    expect((await getRequest(r.id)).status).toBe("SWAP_SUBMITTED");
  });
});

describe("automated executor (disabled by default)", () => {
  beforeEach(async () => {
    await receive(starlet.mint, 10n * SOL);
  });

  it("does nothing while automated execution is off or no signer exists", async () => {
    await approved();
    expect(await runExecutor(new FakeSender())).toEqual({ action: "skipped", reason: "automated execution disabled" });
    await db().fundConfig.update({ where: { id: 1 }, data: { autoExecutionEnabled: true } });
    expect(await runExecutor(new FakeSender())).toEqual({ action: "skipped", reason: "no signer configured" });
  });

  it("cannot be enabled through the config API", async () => {
    await expect(updateFundConfig({ autoExecutionEnabled: true }, ADMIN)).rejects.toMatchObject({ status: 422 });
  });

  it("records the signature before broadcast and recovers after a crash without re-signing", async () => {
    h = installDemolitionDeps(testSigner(f.fund));
    h.chain.balances.set(f.fund, 100n * SOL);
    h.chain.add(distributeTx({ mint: starlet.mint, fund: f.fund, distributed: SOL }));
    await db().fundConfig.update({ where: { id: 1 }, data: { autoExecutionEnabled: true } });
    const r = await approved();
    const sender = new FakeSender();
    sender.crashAfterSign = true; // worker dies after signing, before broadcast
    await expect(runExecutor(sender)).rejects.toThrow(/crashed/);
    const after = await getRequest(r.id);
    expect(after.status).toBe("SWAP_SUBMITTED");
    expect(after.transactions[0]).toMatchObject({ purpose: "SWAP", status: "SUBMITTED", lastValidBlockHeight: 2_000n });

    // Restarted worker: nothing to sign (request is SUBMITTED), and the dead tx expires by height.
    sender.crashAfterSign = false;
    expect(await runExecutor(sender)).toEqual({ action: "skipped", reason: "nothing to execute" });
    h.chain.height = 2_500n;
    expect((await settleSwap(r.id)).status).toBe("APPROVED");
    const res = await runExecutor(sender);
    expect(res.action).toBe("swap");
    expect(sender.sent).toHaveLength(1);
  });
});

describe("reconciliation and disbursements", () => {
  it("passes when the fund holds its liabilities and opens the breaker on a shortfall", async () => {
    await receive(starlet.mint, 10n * SOL);
    h.chain.balances.set(f.fund, 10n * SOL);
    expect((await reconcile()).ok).toBe(true);
    h.chain.balances.set(f.fund, 9n * SOL);
    const run = await reconcile();
    expect(run).toMatchObject({ ok: false, liabilitiesLamports: 10n * SOL });
    expect((await db().fundConfig.findUniqueOrThrow({ where: { id: 1 } })).circuitOpen).toBe(true);
  });

  it("flags purchased tokens missing from the fund", async () => {
    await receive(starlet.mint, 10n * SOL);
    const r = await approved();
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 5_000_000n });
    h.chain.add(s);
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    await settleSwap(r.id);
    h.chain.tokens.set(`${f.fund}:${f.realty}`, 4_000_000n);
    expect((await reconcile()).note).toMatch(/token shortfall 1000000/);
  });

  it("verifies disbursements to the ecosystem wallet and caps them at the allocation", async () => {
    await receive(starlet.mint, 10n * SOL);
    const ok = transferTx({ fund: f.fund, dest: f.ecosystem, lamports: 2n * SOL });
    const tooMuch = transferTx({ fund: f.fund, dest: f.ecosystem, lamports: 3n * SOL });
    const wrongDest = transferTx({ fund: f.fund, dest: newKey(), lamports: SOL });
    for (const t of [ok, tooMuch, wrongDest]) h.chain.add(t);
    await recordDisbursement(ok.signature, "ECOSYSTEM", ADMIN);
    await expect(recordDisbursement(ok.signature, "ECOSYSTEM", ADMIN)).rejects.toMatchObject({ status: 409 });
    await expect(recordDisbursement(tooMuch.signature, "ECOSYSTEM", ADMIN)).rejects.toThrow(/exceeds/);
    await expect(recordDisbursement(wrongDest.signature, "ECOSYSTEM", ADMIN)).rejects.toMatchObject({ status: 422 });
  });
});

describe("admin API authorisation", () => {
  it("rejects anonymous, non-admin and editor attempts to execute", async () => {
    await receive(starlet.mint, 10n * SOL);
    await signInAs(null);
    expect((await buybacksRoute(send("POST", "/api/admin/demolition-fund/buybacks", { idempotencyKey: "anon-key-1" }))).status).toBe(401);
    await signInAs("EDITOR");
    expect((await buybacksRoute(send("POST", "/api/admin/demolition-fund/buybacks", { idempotencyKey: "editor-key" }))).status).toBe(403);
    expect((await receiptsRoute(send("POST", "/api/admin/demolition-fund/receipts", { signature: sig() }))).status).toBe(403);
    expect((await configRoute(send("PATCH", "/api/admin/demolition-fund/config", { buybackBps: 10_000, ecosystemBps: 0, operationsBps: 0 }))).status).toBe(403);
    // An editor may pause in an emergency but not resume.
    expect((await pauseRoute(send("POST", "/api/admin/demolition-fund/pause", { paused: true, reason: "incident" }))).status).toBe(200);
    expect((await pauseRoute(send("POST", "/api/admin/demolition-fund/pause", { paused: false, reason: "all clear" }))).status).toBe(403);
    expect(await db().buybackRequest.count()).toBe(0);
  });

  it("prevents the creator approving their own buyback and blocks cross-origin calls", async () => {
    await receive(starlet.mint, 10n * SOL);
    await signInAs("ADMIN");
    const created = await (await buybacksRoute(send("POST", "/api/admin/demolition-fund/buybacks", { idempotencyKey: "self-appr-1" }))).json();
    h.swap.next = (req) => jupiterBuild({ fund: f.fund, mint: f.realty, amount: req.amount });
    expect((await actionRoute(send("POST", `/api/admin/demolition-fund/buybacks/${created.id}/quote`, {}), params({ id: created.id, action: "quote" }))).status).toBe(200);
    const self = await actionRoute(send("POST", `/api/admin/demolition-fund/buybacks/${created.id}/approve`, {}), params({ id: created.id, action: "approve" }));
    expect(self.status).toBe(403);
    const evil = await buybacksRoute(send("POST", "/api/admin/demolition-fund/buybacks", { idempotencyKey: "evil-key-1" }, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    expect(created.budgetLamports).toBe("5000000000"); // capped at maxBuybackLamportsPerTx; bigint as exact string
  });

  it("rejects invalid allocation percentages", async () => {
    await signInAs("ADMIN");
    const r = await configRoute(send("PATCH", "/api/admin/demolition-fund/config", { buybackBps: 7000, ecosystemBps: 2500, operationsBps: 1500 }));
    expect(r.status).toBe(422);
  });
});

describe("public Demolition Fund API", () => {
  it("shows only verified figures and an empty state before any activity", async () => {
    const empty = await (await summaryRoute(get("/api/demolition-fund/summary"))).json();
    expect(empty.totals).toMatchObject({ creatorFeesLamports: "0", realtyBurnedRaw: "0", successfulBurns: 0, feeReceipts: 0 });
    expect(empty.latestBurn).toBeNull();
    const board = (await (await propertiesRoute(get("/api/demolition-fund/properties"))).json()).items;
    expect(board).toHaveLength(15);
    expect(board.every((p: { rank: number | null; creatorFeesLamports: string }) => p.rank === null && p.creatorFeesLamports === "0")).toBe(true);
  });

  it("reports totals, leaderboard, burns, history and transaction lookups after a full cycle", async () => {
    await receive(ocean.mint, 4n * SOL);
    await receive(starlet.mint, 1n * SOL);
    const r = await approved(undefined, 3_000_000n);
    const s = swapTx({ fund: f.fund, mint: f.realty, spent: r.budgetLamports, received: 3_000_000n });
    h.chain.add(s);
    await recordSwapSubmission(r.id, s.signature, ADMIN);
    await settleSwap(r.id);
    h.chain.tokens.set(`${f.fund}:${f.realty}`, 3_000_000n);
    const b = burnTx({ fund: f.fund, mint: f.realty, amount: 3_000_000n });
    h.chain.add(b);
    await recordBurnSubmission(r.id, b.signature, ADMIN);
    await settleBurn(r.id);

    const sum = await (await summaryRoute(get("/api/demolition-fund/summary"))).json();
    expect(sum.totals).toMatchObject({
      creatorFeesLamports: "5000000000",
      buybackAllocatedLamports: "3000000000",
      ecosystemAllocatedLamports: "1250000000",
      operationsAllocatedLamports: "750000000",
      pendingBuybackLamports: "0",
      realtyPurchasedRaw: "3000000",
      realtyBurnedRaw: "3000000",
      successfulBurns: 1,
      contributingProperties: 2,
    });
    expect(sum.latestBurn.signature).toBe(b.signature);

    const board = (await (await propertiesRoute(get("/api/demolition-fund/properties"))).json()).items;
    expect(board.slice(0, 2).map((p: { property: { ticker: string }; rank: number; realtyBurnedRaw: string }) => [p.property.ticker, p.rank, p.realtyBurnedRaw])).toEqual([
      ["OCEAN", 1, "2400000"],
      ["STARLET", 2, "600000"],
    ]);

    const burns = (await (await burnsRoute(get("/api/demolition-fund/burns"))).json()).items;
    expect(burns[0]).toMatchObject({ signature: b.signature, realtyBurnedRaw: "3000000", buyback: { swapSignature: s.signature } });
    const hist = (await (await historyRoute(get("/api/demolition-fund/history?limit=10"))).json()).items;
    expect(hist.map((e: { type: string }) => e.type).sort()).toEqual(["BURN", "BUYBACK", "FEE_RECEIPT", "FEE_RECEIPT"]);
    const lookup = await (await txRoute(get(`/api/demolition-fund/transactions/${s.signature}`), params({ signature: s.signature }))).json();
    expect(lookup).toMatchObject({ kind: "SWAP", status: "FINALIZED" });
    expect((await txRoute(get("/api/demolition-fund/transactions/bad"), params({ signature: "bad" }))).status).toBe(400);
  });
});

void SYSTEM_ACTOR;
