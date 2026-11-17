import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { splitByBps, ratioStringToBps } from "@/server/demolition/money";
import { decodeDistributeEvent, encodeDistributeEvent, PUMP_PROGRAMS, sharingConfigAddress } from "@/server/demolition/pump-fees";
import { parseBuild, QuoteRejected } from "@/server/demolition/jupiter";
import { assertBurnAllowed, assertSwapAllowed, JUPITER_V6_PROGRAM, PolicyViolation, SYSTEM_PROGRAM } from "@/server/demolition/policy";
import { burnedIn, verifySwapTx } from "@/server/demolition/buyback";
import { PROGRAMS } from "@/server/solana/address";
import { burnTx, jupiterBuild, swapTx } from "../helpers/demolition";

const key = () => Keypair.generate().publicKey.toBase58();
const WSOL = PROGRAMS.WRAPPED_SOL;

describe("hard-coded program ids", () => {
  it("are all valid public keys (regression: a mistyped Token-2022 id once slipped in)", async () => {
    const policy = await import("@/server/demolition/policy");
    const ids = [
      ...Object.values(PROGRAMS),
      ...Object.values(PUMP_PROGRAMS),
      policy.COMPUTE_BUDGET_PROGRAM,
      policy.SYSTEM_PROGRAM,
      policy.ASSOCIATED_TOKEN_PROGRAM,
      policy.JUPITER_V6_PROGRAM,
    ];
    for (const id of ids) expect(() => new PublicKey(id), id).not.toThrow();
    expect(PROGRAMS.TOKEN_2022).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"); // as exported by @solana/spl-token
  });
});

describe("fee allocation (integer basis points)", () => {
  it("splits 60/25/15 exactly with no lamport lost", () => {
    const s = splitByBps(1_000_000_001n, { buyback: 6000, ecosystem: 2500, operations: 1500 });
    expect(s).toEqual({ buyback: 600_000_001n, ecosystem: 250_000_000n, operations: 150_000_000n });
    expect(s.buyback + s.ecosystem + s.operations).toBe(1_000_000_001n);
  });
  it("gives rounding remainders to the buyback share and handles tiny amounts", () => {
    // 7 * 25% = 1.75 -> 1; 7 * 15% = 1.05 -> 1; buyback takes the rest (5), so nothing is lost.
    expect(splitByBps(7n, { buyback: 6000, ecosystem: 2500, operations: 1500 })).toEqual({ buyback: 5n, ecosystem: 1n, operations: 1n });
    expect(splitByBps(3n, { buyback: 6000, ecosystem: 2500, operations: 1500 })).toEqual({ buyback: 3n, ecosystem: 0n, operations: 0n });
    expect(splitByBps(0n, { buyback: 6000, ecosystem: 2500, operations: 1500 })).toEqual({ buyback: 0n, ecosystem: 0n, operations: 0n });
  });
  it("supports configurable percentages and rejects invalid ones", () => {
    expect(splitByBps(10_000n, { buyback: 10_000, ecosystem: 0, operations: 0 }).buyback).toBe(10_000n);
    expect(() => splitByBps(1n, { buyback: 6000, ecosystem: 2500, operations: 1000 })).toThrow();
    expect(() => splitByBps(1n, { buyback: 6000.5, ecosystem: 2499.5, operations: 1500 })).toThrow();
    expect(() => splitByBps(-1n, { buyback: 6000, ecosystem: 2500, operations: 1500 })).toThrow();
  });
  it("is exact for amounts beyond Number.MAX_SAFE_INTEGER", () => {
    const big = 2n ** 63n - 1n;
    const s = splitByBps(big, { buyback: 6000, ecosystem: 2500, operations: 1500 });
    expect(s.buyback + s.ecosystem + s.operations).toBe(big);
  });
  it("rounds price impact up (conservative)", () => {
    expect(ratioStringToBps("0.00011")).toBe(2);
    expect(ratioStringToBps("bad")).toBeNull();
    expect(ratioStringToBps("-1")).toBeNull();
  });
});

describe("Pump DistributeCreatorFeesEvent", () => {
  it("round-trips the on-chain layout and derives the sharing-config PDA", () => {
    const mint = key();
    const sc = sharingConfigAddress(mint);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("sharing-config"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP_PROGRAMS.fees));
    expect(sc).toBe(expected.toBase58());
    const fund = key();
    const e = decodeDistributeEvent(encodeDistributeEvent({ mint, sharingConfig: sc, shareholders: [{ address: fund, shareBps: 10_000 }], distributed: 123_456_789n }));
    expect(e).toEqual({ mint, sharingConfig: sc, shareholders: [{ address: fund, shareBps: 10_000 }], distributed: 123_456_789n });
  });
  it("rejects other events, truncated data and absurd shareholder counts", () => {
    expect(decodeDistributeEvent(Buffer.alloc(40))).toBeNull();
    const good = encodeDistributeEvent({ mint: key(), sharingConfig: key(), shareholders: [{ address: key(), shareBps: 10_000 }], distributed: 1n });
    expect(decodeDistributeEvent(good.subarray(0, good.length - 4))).toBeNull();
    const bad = Buffer.from(good);
    bad.writeUInt32LE(1000, 16 + 8 + 32 * 4); // shareholder count
    expect(decodeDistributeEvent(bad)).toBeNull();
  });
});

describe("Jupiter /build validation", () => {
  const fund = key();
  const mint = key();
  const body = (over: Record<string, unknown> = {}) => ({
    inputMint: WSOL,
    outputMint: mint,
    inAmount: "1000000000",
    outAmount: "5000000",
    otherAmountThreshold: "4950000",
    slippageBps: 100,
    priceImpactPct: "0.004",
    routePlan: [{ swapInfo: { label: "PumpSwap", inputMint: WSOL, outputMint: mint, ammKey: key(), inAmount: "1", outAmount: "1" }, percent: 100, bps: 10000 }],
    computeBudgetInstructions: [],
    setupInstructions: [],
    swapInstruction: { programId: JUPITER_V6_PROGRAM, accounts: [{ pubkey: fund, isSigner: true, isWritable: true }], data: "AQ==" },
    cleanupInstruction: null,
    otherInstructions: [],
    addressesByLookupTableAddress: {},
    ...over,
  });
  const req = { inputMint: WSOL, outputMint: mint, amount: 1_000_000_000n, slippageBps: 100 };

  it("accepts a consistent quote", () => {
    const b = parseBuild(body(), req);
    expect(b).toMatchObject({ inAmount: 1_000_000_000n, outAmount: 5_000_000n, minOut: 4_950_000n, priceImpactBps: 40, routeLabels: ["PumpSwap"] });
  });
  it.each([
    ["wrong output mint", { outputMint: key() }],
    ["wrong input amount", { inAmount: "999" }],
    ["slippage floor violated", { otherAmountThreshold: "4000000" }],
    ["slippage above tolerance", { slippageBps: 500 }],
    ["non-integer amounts", { outAmount: "5e6" }],
    ["route ends elsewhere", { routePlan: [{ swapInfo: { label: "X", inputMint: WSOL, outputMint: key() } }] }],
    ["missing price impact", { priceImpactPct: "n/a" }],
    ["invalid instruction address", { swapInstruction: { programId: "evil", accounts: [], data: "" } }],
    ["malformed", { routePlan: "nope" }],
  ])("rejects %s", (_, over) => {
    expect(() => parseBuild(body(over), req)).toThrow(QuoteRejected);
  });
});

describe("pre-signing policy", () => {
  const fund = key();
  const mint = key();
  const policy = { fundWallet: fund, targetMint: mint, budgetLamports: 1_000_000_000n, maxPriceImpactBps: 200, slippageBps: 100, swapPrograms: [JUPITER_V6_PROGRAM] };

  it("allows a clean swap", () => {
    expect(() => assertSwapAllowed(jupiterBuild({ fund, mint, amount: 1_000_000_000n }), policy)).not.toThrow();
  });
  it("denies wrong mint, budget, impact, programs and extra signers", () => {
    const b = jupiterBuild({ fund, mint, amount: 1_000_000_000n });
    expect(() => assertSwapAllowed({ ...b, outputMint: key() }, policy)).toThrow(PolicyViolation);
    expect(() => assertSwapAllowed({ ...b, inAmount: 2n }, policy)).toThrow(PolicyViolation);
    expect(() => assertSwapAllowed({ ...b, priceImpactBps: 201 }, policy)).toThrow(/Price impact/);
    expect(() => assertSwapAllowed({ ...b, instructions: { ...b.instructions, swap: { ...b.instructions.swap, programId: key() } } }, policy)).toThrow(/not allowlisted/);
    expect(() => assertSwapAllowed({ ...b, instructions: { ...b.instructions, other: [{ programId: key(), accounts: [], data: "" }] } }, policy)).toThrow(/not allowlisted/);
    const thief = key();
    expect(() => assertSwapAllowed({ ...b, instructions: { ...b.instructions, swap: { ...b.instructions.swap, accounts: [{ pubkey: thief, isSigner: true, isWritable: true }] } } }, policy)).toThrow(/Unexpected signer/);
  });
  it("only allows SOL wrapping transfers from the fund within budget", () => {
    const b = jupiterBuild({ fund, mint, amount: 1_000_000_000n });
    const transfer = (from: string, lamports: bigint) => {
      const d = Buffer.alloc(12);
      d.writeUInt32LE(2);
      d.writeBigUInt64LE(lamports, 4);
      return { programId: SYSTEM_PROGRAM, accounts: [{ pubkey: from, isSigner: from === fund, isWritable: true }, { pubkey: key(), isSigner: false, isWritable: true }], data: d.toString("base64") };
    };
    expect(() => assertSwapAllowed({ ...b, instructions: { ...b.instructions, setup: [transfer(fund, 1_000_000_000n)] } }, policy)).not.toThrow();
    expect(() => assertSwapAllowed({ ...b, instructions: { ...b.instructions, setup: [transfer(fund, 5_000_000_000n)] } }, policy)).toThrow(/exceeds/);
  });
  it("burn must be one exact BurnChecked of the target from the fund", () => {
    const account = key();
    const data = Buffer.alloc(10);
    data[0] = 15;
    data.writeBigUInt64LE(500n, 1);
    data[9] = 6;
    const ix = { programId: PROGRAMS.TOKEN_2022, accounts: [{ pubkey: account, isSigner: false }, { pubkey: mint, isSigner: false }, { pubkey: fund, isSigner: true }], data };
    const p = { fundWallet: fund, targetMint: mint, tokenAccount: account, amount: 500n, decimals: 6 };
    expect(() => assertBurnAllowed(ix, p)).not.toThrow();
    expect(() => assertBurnAllowed(ix, { ...p, amount: 501n })).toThrow(PolicyViolation);
    expect(() => assertBurnAllowed({ ...ix, programId: key() }, p)).toThrow(PolicyViolation);
    expect(() => assertBurnAllowed(ix, { ...p, targetMint: key() })).toThrow(PolicyViolation); // invalid token account / mint
  });
});

describe("on-chain verification", () => {
  const fund = key();
  const mint = key();
  it("verifies swap settlement from balance changes, not the quote", () => {
    const ok = verifySwapTx(swapTx({ fund, mint, spent: 1_000_000_000n, received: 5_000_000n }), { fund, targetMint: mint, budget: 1_000_000_000n, minOut: 4_950_000n, notBefore: new Date(0) });
    expect(ok).toMatchObject({ ok: true, spent: 1_000_000_000n, received: 5_000_000n });
    const short = verifySwapTx(swapTx({ fund, mint, spent: 1_000_000_000n, received: 4_000_000n }), { fund, targetMint: mint, budget: 1_000_000_000n, minOut: 4_950_000n, notBefore: new Date(0) });
    expect(short).toMatchObject({ ok: false, reason: "Received less than the approved minimum" });
    const wrongMint = verifySwapTx(swapTx({ fund, mint: key(), spent: 1n, received: 9n }), { fund, targetMint: mint, budget: 10n, minOut: null, notBefore: new Date(0) });
    expect(wrongMint.ok).toBe(false);
    const over = verifySwapTx(swapTx({ fund, mint, spent: 2_000_000_000n, received: 5_000_000n }), { fund, targetMint: mint, budget: 1_000_000_000n, minOut: null, notBefore: new Date(0) });
    expect(over).toMatchObject({ ok: false, reason: "Swap spent more than the approved budget" });
    const old = verifySwapTx(swapTx({ fund, mint, spent: 1n, received: 1n, blockTime: new Date(1000) }), { fund, targetMint: mint, budget: 10n, minOut: null, notBefore: new Date(5000) });
    expect(old.reason).toBe("Transaction predates this buyback");
  });
  it("counts only burns of the target mint by the fund in successful transactions", () => {
    expect(burnedIn(burnTx({ fund, mint, amount: 700n }), { mint, authority: fund })).toBe(700n);
    expect(burnedIn(burnTx({ fund, mint, amount: 700n, authority: key() }), { mint, authority: fund })).toBe(0n);
    expect(burnedIn(burnTx({ fund, mint: key(), amount: 700n }), { mint, authority: fund })).toBe(0n);
    expect(burnedIn(burnTx({ fund, mint, amount: 700n, err: { InstructionError: [0, "x"] } }), { mint, authority: fund })).toBe(0n);
    expect(burnedIn(burnTx({ fund, mint, amount: 700n, program: key() }), { mint, authority: fund })).toBe(0n);
  });
});
