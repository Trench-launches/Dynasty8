import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";
import { resetConfigForTests } from "@/server/config";
import { approveBuyback, createBuybackRequest, getRequest, quoteBuyback, settleAll } from "@/server/demolition/buyback";
import { setWallet } from "@/server/demolition/fund";
import { buildMemberTransaction, prepareProposal, syncAllProposals } from "@/server/demolition/proposals";
import { encodeDistributeEvent, PUMP_PROGRAMS, sharingConfigAddress } from "@/server/demolition/pump-fees";
import { verifyAndRecordReceipt } from "@/server/demolition/receipts";
import { ledgerTotals, reconcile } from "@/server/demolition/reconcile";
import { getFundSummary } from "@/server/demolition/dashboard";
import { db, installMockProviders, makeLive, newKey, resetDatabase, validMint } from "../helpers/fixtures";
import { burnTx, installDemolitionDeps, jupiterBuild, sig, swapTx, type DemolitionHarness } from "../helpers/demolition";
import type { ChainTx } from "@/server/demolition/chain";

/**
 * $DYNASTY buyback-and-burn REHEARSAL with the owner's real configuration: the Dynasty multisig
 * address, its three real members and 2-of-3 threshold, the three real vaults at 60/25/15. The
 * chain, Squads and Jupiter are simulated (nothing touches a network); every Squads transaction
 * a member would sign is built for real and checked. Companion read-only network rehearsal:
 * scripts/rehearsal/dynasty-buyback-rehearsal.ts.
 */
const SOL = 1_000_000_000n;
const ADMIN = { id: "admin-1", label: "owner" };
const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as { multisig: string; wallets: { role: "FUND" | "ECOSYSTEM" | "OPERATIONS"; vaultIndex: number; address: string; shareBps: number }[] };
const MEMBERS = ["AmAU7AEHnBYnvsuKe4SPzX2KB9tKNxMs7UbnMus7Gdi", "4EmLpWNvKQqifcKxGxGev7rYoGRPkPMyVfxnP6XhuHU2", "Cq3EGix162DX5DZZbLdDNK9DcggFxhfHUK9yEphtzN5P"];
const vault = (role: string) => treasury.wallets.find((w) => w.role === role)!.address;

let h: DemolitionHarness;
let dynasty: string;

/** A Pump distribute paying the three real vaults their 60/25/15 shares of `fees`. */
function distribute(mint: string, fees: bigint): ChainTx {
  const holders = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
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
    postBalances: keys.map((_, i) => (i === 0 ? 995_000n : 1_000_000n + (fees * BigInt(holders[i - 1]!.shareBps)) / 10_000n)),
    preTokenBalances: [],
    postTokenBalances: [],
    instructions: [
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(Buffer.from([255, 203, 19, 79, 244, 68, 8, 159, 0])), parsed: null, accounts: [], inner: false },
      { programId: PUMP_PROGRAMS.pump, data: bs58.encode(encodeDistributeEvent({ mint, sharingConfig: sharingConfigAddress(mint), shareholders: holders, distributed: fees, quoteMint: "11111111111111111111111111111111" })), parsed: null, accounts: [], inner: false },
    ].map((ix, i) => ({ ...ix, inner: i === 1 })),
  };
}

beforeEach(async () => {
  await resetDatabase();
  const mocks = installMockProviders();
  h = installDemolitionDeps();
  h.squads.addMultisig({
    address: treasury.multisig,
    threshold: 2,
    timeLockSeconds: 0,
    transactionIndex: 0n,
    staleTransactionIndex: 0n,
    configAuthority: null,
    members: MEMBERS.map((key) => ({ key, initiate: true, vote: true, execute: true })),
  });
  // Registration exactly as `npm run fund:register -- --config config/treasury.mainnet.json` does it.
  for (const w of treasury.wallets) await setWallet(w.role, { address: w.address, label: w.role, isMultisig: true, multisigAddress: treasury.multisig, vaultIndex: w.vaultIndex }, ADMIN);
  dynasty = newKey();
  mocks.mints.set(dynasty, { ...validMint(), program: "TOKEN_2022" });
  const native = await db().token.findFirstOrThrow({ where: { isNative: true } });
  await db().token.update({ where: { id: native.id }, data: { mintAddress: dynasty, deploymentStatus: "LIVE", metadataStatus: "VERIFIED", decimals: 6 } });
  await db().marketSnapshot.create({ data: { tokenId: native.id, source: "rehearsal", liquidityUsd: 250_000, priceUsd: 0.001 } });
  await db().fundConfig.upsert({
    where: { id: 1 },
    create: { id: 1, paused: false, allocationMode: "ON_CHAIN_SPLIT", requiredApprovals: 1, cooldownSeconds: 60 },
    update: { paused: false, pausedReason: null, allocationMode: "ON_CHAIN_SPLIT", requiredApprovals: 1, cooldownSeconds: 60 },
  });
  process.env.FUND_ALLOW_SINGLE_SIG = "false"; // production rule: multisig only
  resetConfigForTests();
});

afterEach(() => {
  process.env.FUND_ALLOW_SINGLE_SIG = "true";
  resetConfigForTests();
});

const decode = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, "base64"));

describe("DYNASTY buyback-and-burn rehearsal (real multisig, members and vaults; simulated chain)", () => {
  it("runs fees -> plan -> quote -> proposal -> 2-of-3 approvals -> execute -> purchase -> burn proposal -> burn -> dashboard", async () => {
    // Two launched property coins earn creator fees, paid by Pump straight to the three vaults.
    const starlet = await makeLive("starlet-motel");
    const ocean = await makeLive("ocean-view-hotel");
    for (const [mint, fees] of [[starlet.mint, 2n * SOL], [ocean.mint, 1n * SOL]] as const) {
      const tx = distribute(mint, fees);
      h.chain.add(tx);
      await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    }
    const t = await ledgerTotals();
    expect(t.buybackAllocated).toBe(1_800_000_000n); // 60% of 3 SOL
    expect(t.ecosystemPaidDirect).toBe(750_000_000n); // 25%, straight to FF5m…
    expect(t.operationsPaidDirect).toBe(450_000_000n); // 15%, straight to A5op…
    h.chain.balances.set(vault("FUND"), 1_800_000_000n + 1_000_000n);

    // Plan, quote (Jupiter mocked), admin approval.
    const req = await createBuybackRequest({ idempotencyKey: "rehearsal-1" }, ADMIN);
    expect(req.budgetLamports).toBeGreaterThan(0n);
    h.swap.next = (q) => jupiterBuild({ fund: vault("FUND"), mint: dynasty, amount: q.amount, out: 5_000_000_000n });
    await quoteBuyback(req.id, ADMIN);
    await approveBuyback(req.id, "second-admin", undefined, ADMIN);

    // Member 1 creates the swap proposal (unsigned, signed only by that member).
    const swap = await prepareProposal(req.id, "SWAP", MEMBERS[0]!, ADMIN);
    expect(swap).toMatchObject({ multisig: treasury.multisig, vault: vault("FUND"), transactionIndex: 1n, threshold: 2 });
    expect(decode(swap.transactionBase64).message.staticAccountKeys[0]!.toBase58()).toBe(MEMBERS[0]);
    h.squads.memberCreates(swap, swap.expectedMessage);
    await syncAllProposals();

    // Members 2 and 3 each get an approve transaction for their own wallet; two votes reach the threshold.
    const row = await db().multisigProposal.findFirstOrThrow({ where: { purpose: "SWAP" } });
    for (const m of [MEMBERS[1]!, MEMBERS[2]!]) {
      const a = await buildMemberTransaction(row.id, "approve", m, ADMIN);
      expect(decode(a.transactionBase64).message.staticAccountKeys[0]!.toBase58()).toBe(m);
      h.squads.approve(treasury.multisig, swap.proposalPda, m);
    }
    expect(await syncAllProposals()).toEqual({ APPROVED: 1 });
    expect((await getRequest(req.id)).status).toBe("APPROVED"); // nothing has executed yet

    // Member 1 executes; the worker binds the execution to this proposal and settles the purchase.
    await buildMemberTransaction(row.id, "execute", MEMBERS[0]!, ADMIN);
    h.squads.execute(swap, swapTx({ fund: vault("FUND"), mint: dynasty, spent: req.budgetLamports, received: 5_000_000_000n }), MEMBERS[0]);
    await syncAllProposals();
    await settleAll();
    expect(await getRequest(req.id)).toMatchObject({ status: "SWAP_CONFIRMED", tokensReceivedRaw: 5_000_000_000n });

    // Burn every purchased token through a second proposal.
    h.chain.tokens.set(`${vault("FUND")}:${dynasty}`, 5_000_000_000n);
    const burn = await prepareProposal(req.id, "BURN", MEMBERS[1]!, ADMIN);
    h.squads.memberCreates(burn, burn.expectedMessage);
    h.squads.approve(treasury.multisig, burn.proposalPda, MEMBERS[0]!);
    h.squads.approve(treasury.multisig, burn.proposalPda, MEMBERS[2]!);
    await syncAllProposals();
    h.squads.execute(burn, burnTx({ fund: vault("FUND"), mint: dynasty, amount: 5_000_000_000n }), MEMBERS[2]);
    await syncAllProposals();
    await settleAll();
    expect(await getRequest(req.id)).toMatchObject({ status: "BURNED", tokensBurnedRaw: 5_000_000_000n });

    // Ledger and public dashboard.
    h.chain.balances.set(vault("FUND"), 1_800_000_000n + 1_000_000n - req.budgetLamports);
    h.chain.tokens.set(`${vault("FUND")}:${dynasty}`, 0n);
    expect((await reconcile()).ok).toBe(true);
    const s = await getFundSummary();
    expect(s.buybacks[0]).toMatchObject({ verification: "BURN_VERIFIED", dynastyBurnedRaw: "5000000000" });
    expect(s.totals).toMatchObject({ dynastyBurnedRaw: "5000000000", successfulBurns: 1, feeReceipts: 2, contributingProperties: 2 });
    expect(s.pendingActions).toEqual([]);
    expect(await db().multisigProposal.count({ where: { status: "EXECUTED" } })).toBe(2);
  });

  it("refuses a single member's attempt to execute before the second approval", async () => {
    const starlet = await makeLive("starlet-motel");
    const tx = distribute(starlet.mint, 2n * SOL);
    h.chain.add(tx);
    await verifyAndRecordReceipt(tx.signature, "MANUAL", ADMIN);
    h.chain.balances.set(vault("FUND"), 1_201_000_000n);
    const req = await createBuybackRequest({ idempotencyKey: "rehearsal-2" }, ADMIN);
    h.swap.next = (q) => jupiterBuild({ fund: vault("FUND"), mint: dynasty, amount: q.amount, out: 1_000_000n });
    await quoteBuyback(req.id, ADMIN);
    await approveBuyback(req.id, "second-admin", undefined, ADMIN);
    const swap = await prepareProposal(req.id, "SWAP", MEMBERS[0]!, ADMIN);
    h.squads.memberCreates(swap, swap.expectedMessage);
    h.squads.approve(treasury.multisig, swap.proposalPda, MEMBERS[0]!);
    const row = await db().multisigProposal.findFirstOrThrow();
    await expect(buildMemberTransaction(row.id, "execute", MEMBERS[0]!, ADMIN)).rejects.toThrow(/1 of 2/);
  });
});
