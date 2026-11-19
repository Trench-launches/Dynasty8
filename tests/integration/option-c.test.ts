import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { resetConfigForTests } from "@/server/config";
import { approveBuyback, createBuybackRequest, quoteBuyback } from "@/server/demolition/buyback";
import { checkFeeSharing, expectedShareholdersFor } from "@/server/demolition/fee-sharing";
import { buildMemberTransaction, prepareProposal } from "@/server/demolition/proposals";
import { encodeDistributeEvent, PUMP_PROGRAMS, sharingConfigAddress, SHARING_CONFIG_DISCRIMINATOR } from "@/server/demolition/pump-fees";
import { verifyAndRecordReceipt } from "@/server/demolition/receipts";
import { ledgerTotals } from "@/server/demolition/reconcile";
import { getFundSummary, getPropertyContributions } from "@/server/demolition/dashboard";
import { db, installMockProviders, makeLive, newKey, resetDatabase } from "../helpers/fixtures";
import { installDemolitionDeps, jupiterBuild, setupFund, sig, type DemolitionHarness } from "../helpers/demolition";
import type { ChainTx } from "@/server/demolition/chain";

/**
 * Option C (owner decision 2026-11-18): 100% of $DYNASTY's own Pump creator fees go to the FUND
 * vault and count as buyback revenue. Property coins keep 60/25/15. Mocked chain throughout.
 */
const SOL = 1_000_000_000n;
const ADMIN = { id: "admin-1", label: "owner" };
let h: DemolitionHarness;
let f: Awaited<ReturnType<typeof setupFund>>;

function distribute(mint: string, fees: bigint, holders: { address: string; shareBps: number }[], arrived?: Record<string, bigint>): ChainTx {
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
    postBalances: keys.map((k, i) => (i === 0 ? 995_000n : 1_000_000n + (arrived?.[k] ?? (fees * BigInt(holders[i - 1]!.shareBps)) / 10_000n))),
    preTokenBalances: [],
    postTokenBalances: [],
    instructions: [
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(Buffer.from([255, 203, 19, 79, 244, 68, 8, 159, 0])), parsed: null, accounts: [], inner: false },
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(encodeDistributeEvent({ mint, sharingConfig: sharingConfigAddress(mint), shareholders: holders, distributed: fees, quoteMint: "11111111111111111111111111111111" })), parsed: null, accounts: [], inner: true },
    ],
  };
}

function sharingConfig(mint: string, holders: { address: string; shareBps: number }[], revoked = true) {
  const n = Buffer.alloc(4);
  n.writeUInt32LE(holders.length);
  return Buffer.concat([
    SHARING_CONFIG_DISCRIMINATOR,
    Buffer.from([255, 2, 1]),
    new PublicKey(mint).toBuffer(),
    new PublicKey(newKey()).toBuffer(),
    Buffer.from([revoked ? 1 : 0]),
    n,
    ...holders.flatMap((x) => {
      const s = Buffer.alloc(2);
      s.writeUInt16LE(x.shareBps);
      return [new PublicKey(x.address).toBuffer(), s];
    }),
  ]);
}

const fund100 = () => [{ address: f.fund, shareBps: 10_000 }];
const split = () => [
  { address: f.fund, shareBps: 6000 },
  { address: f.ecosystem, shareBps: 2500 },
  { address: f.operations, shareBps: 1500 },
];

async function record(tx: ChainTx) {
  h.chain.add(tx);
  return verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
}

beforeEach(async () => {
  await resetDatabase();
  installMockProviders();
  h = installDemolitionDeps();
  f = await setupFund({ mode: "ON_CHAIN_SPLIT" }); // registers DYNASTY (f.dynasty) as the native token, LIVE
});

afterEach(() => {
  process.env.FUND_ALLOW_SINGLE_SIG = "true";
  resetConfigForTests();
});

describe("Option C: $DYNASTY creator fees are 100% buyback revenue", () => {
  it("books a verified $DYNASTY distribution (FUND 100%) entirely as buyback revenue, outside the property leaderboard", async () => {
    const r = await record(distribute(f.dynasty, 2n * SOL, fund100()));
    expect(r).toMatchObject({ created: 1, duplicates: 0, warnings: [] });
    const receipt = await db().feeReceipt.findFirstOrThrow({ include: { allocation: true } });
    expect(receipt).toMatchObject({ propertyId: null, lamports: 2n * SOL, shareBps: 10_000 });
    expect(receipt.allocation).toMatchObject({ buybackLamports: 2n * SOL, ecosystemLamports: 0n, operationsLamports: 0n, buybackBps: 10_000, ecosystemBps: 0, operationsBps: 0, paidDirect: true });
    expect((await ledgerTotals()).buybackAllocated).toBe(2n * SOL);
    const s = await getFundSummary();
    expect(s.totals).toMatchObject({ creatorFeesLamports: "2000000000", dynastyCreatorFeesLamports: "2000000000", contributingProperties: 0, feeReceipts: 1 });
    expect((await getPropertyContributions()).every((c) => c.creatorFeesLamports === "0")).toBe(true);
  });

  it("keeps property coins on 60/25/15 alongside it", async () => {
    const starlet = await makeLive("starlet-motel");
    await record(distribute(f.dynasty, 1n * SOL, fund100()));
    await record(distribute(starlet.mint, 1n * SOL, split()));
    const t = await ledgerTotals();
    expect(t.buybackAllocated).toBe(1_600_000_000n); // 1 SOL (DYNASTY, 100%) + 0.6 SOL (60% of STARLET)
    expect(t.ecosystemPaidDirect).toBe(250_000_000n);
    expect(t.operationsPaidDirect).toBe(150_000_000n);
    const s = await getFundSummary();
    expect(s.totals).toMatchObject({ dynastyCreatorFeesLamports: "1000000000", contributingProperties: 1, feeReceipts: 2 });
    expect((await getPropertyContributions()).find((c) => c.property.slug === "starlet-motel")).toMatchObject({ creatorFeesLamports: "1000000000", buybackAllocatedLamports: "600000000" });
  });

  it("never double counts: re-recording the same distribution is a duplicate", async () => {
    const tx = distribute(f.dynasty, 1n * SOL, fund100());
    await record(tx);
    expect(await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN)).toMatchObject({ created: 0, duplicates: 1 });
    expect(await db().feeReceipt.count()).toBe(1);
    expect(await db().revenueAllocation.count()).toBe(1);
  });

  it("rejects unverified deposits: the fund must really receive the share", async () => {
    await expect(record(distribute(f.dynasty, 1n * SOL, fund100(), { [f.fund]: 1_000n }))).rejects.toThrow(/balance rose by/);
    expect(await db().feeReceipt.count()).toBe(0);
  });

  it("flags a $DYNASTY config that uses the property split, books only what the fund actually received", async () => {
    const r = await record(distribute(f.dynasty, 1n * SOL, split()));
    expect(r.warnings).toEqual([{ reason: "split_mismatch", mint: f.dynasty }]);
    const a = await db().revenueAllocation.findFirstOrThrow();
    expect(a).toMatchObject({ buybackLamports: 600_000_000n, ecosystemLamports: 250_000_000n, operationsLamports: 150_000_000n, buybackBps: 10_000 });
  });

  it("ignores fees for a $DYNASTY mint that is not registered, and other unrelated mints", async () => {
    await db().token.updateMany({ where: { isNative: true }, data: { mintAddress: null, deploymentStatus: "NOT_LAUNCHED", metadataStatus: "UNVERIFIED", decimals: null } });
    const r = await record(distribute(f.dynasty, 1n * SOL, fund100()));
    expect(r).toMatchObject({ created: 0, ignored: [{ reason: "unregistered_mint", mint: f.dynasty }] });
  });

  it("is 100% buyback even when the fund runs in FUND_SPLITS mode (the property split never applies)", async () => {
    await db().fundConfig.update({ where: { id: 1 }, data: { allocationMode: "FUND_SPLITS" } });
    await record(distribute(f.dynasty, 1n * SOL, fund100()));
    expect(await db().revenueAllocation.findFirstOrThrow()).toMatchObject({ buybackLamports: 1n * SOL, ecosystemLamports: 0n, operationsLamports: 0n, paidDirect: true });
  });

  it("checks $DYNASTY's on-chain fee-sharing config against FUND 100%, and properties against 60/25/15", async () => {
    const starlet = await makeLive("starlet-motel");
    expect((await expectedShareholdersFor("NATIVE"))!.holders).toEqual(fund100());
    h.chain.accounts.set(sharingConfigAddress(f.dynasty), { owner: PUMP_PROGRAMS.fees, data: sharingConfig(f.dynasty, fund100()) });
    h.chain.accounts.set(sharingConfigAddress(starlet.mint), { owner: PUMP_PROGRAMS.fees, data: sharingConfig(starlet.mint, split()) });
    expect(await checkFeeSharing()).toEqual({ checked: 2, ok: 2, mismatched: 0 });
    // The wrong policy on either coin is caught.
    h.chain.accounts.set(sharingConfigAddress(f.dynasty), { owner: PUMP_PROGRAMS.fees, data: sharingConfig(f.dynasty, split()) });
    h.chain.accounts.set(sharingConfigAddress(starlet.mint), { owner: PUMP_PROGRAMS.fees, data: sharingConfig(starlet.mint, fund100()) });
    expect(await checkFeeSharing()).toEqual({ checked: 2, ok: 0, mismatched: 2 });
    const native = await db().token.findFirstOrThrow({ where: { isNative: true } });
    expect((await db().feeSharingCheck.findUniqueOrThrow({ where: { tokenId: native.id } })).issues.join(" ")).toMatch(/unexpected shareholder/);
  });

  it("self-generated $DYNASTY fees cannot bypass the buyback risk controls or the 2-of-3 multisig", async () => {
    await resetDatabase();
    installMockProviders();
    h = installDemolitionDeps();
    f = await setupFund({ mode: "ON_CHAIN_SPLIT", multisig: h.squads });
    process.env.FUND_ALLOW_SINGLE_SIG = "false";
    resetConfigForTests();
    await db().fundConfig.update({ where: { id: 1 }, data: { maxBuybackLamportsPerTx: 500_000_000n } });
    h.chain.balances.set(f.fund, 50n * SOL);
    await record(distribute(f.dynasty, 10n * SOL, fund100())); // large self-generated revenue
    const req = await createBuybackRequest({ idempotencyKey: "native-funded" }, ADMIN);
    expect(req.budgetLamports).toBe(500_000_000n); // per-transaction cap still applies
    await expect(createBuybackRequest({ idempotencyKey: "second-at-once" }, ADMIN)).rejects.toThrow(); // one active buyback at a time
    h.swap.next = (q) => jupiterBuild({ fund: f.fund, mint: f.dynasty, amount: q.amount, out: 1_000_000n });
    await quoteBuyback(req.id, ADMIN);
    await approveBuyback(req.id, "other-admin", undefined, ADMIN);
    const p = await prepareProposal(req.id, "SWAP", h.squads.members[0]!, ADMIN);
    h.squads.memberCreates(p, p.expectedMessage);
    h.squads.approve(f.multisigAddress!, p.proposalPda, h.squads.members[0]!);
    const row = await db().multisigProposal.findFirstOrThrow();
    await expect(buildMemberTransaction(row.id, "execute", h.squads.members[0]!, ADMIN)).rejects.toThrow(/1 of 2/);
  });
});
