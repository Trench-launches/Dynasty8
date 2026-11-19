/**
 * Read-only mainnet simulations of the FALLBACK (separate transactions). Nothing is signed or sent.
 *   1. Step 1, create_v2 only, for every coin (fresh mint each).
 *   2. Step 3, the 0.01 SOL buy, priced from a LIVE curve: run against a real, recently created Pump
 *      coin (the step-2 fee-sharing setup on a live coin is proven by simulate-launch-setup.ts).
 * The payer is the funded account recorded in docs/launch/simulation-report.json, for simulation only.
 *
 *   npx tsx --conditions=react-server scripts/verify/simulate-fallback.ts [--out docs/launch/fallback-simulation-report.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function main() {
  const b = await import("../../src/server/demolition/launch-builder");
  const { decodeBondingCurve } = await import("../../src/server/demolition/fee-sharing-setup");
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const payer = JSON.parse(readFileSync("docs/launch/simulation-report.json", "utf8")).simulatedPayer as string;
  const coins = [JSON.parse(readFileSync("config/launch/dynasty.mainnet.json", "utf8")).coin, ...JSON.parse(readFileSync("config/launch/properties.mainnet.json", "utf8")).coins] as { slug: string; name: string; symbol: string }[];
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const blockhash = (await retry(() => conn.getLatestBlockhash())).blockhash;
  const uri = (slug: string) => `https://ipfs.io/ipfs/Qm${slug.replace(/[^a-z]/g, "").padEnd(44, "x").slice(0, 44)}`;

  // 1. Step 1 for every coin.
  const step1 = [];
  for (const c of coins) {
    const tx = b.compileInstructions(payer, blockhash, b.buildCreateOnlyInstructions({ name: c.name, symbol: c.symbol, uri: uri(c.slug), mint: Keypair.generate().publicKey.toBase58(), creator: payer, priorityMicroLamports: 50_000 }));
    const r = await retry(() => conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }));
    step1.push({ symbol: c.symbol, ok: r.value.err === null, err: r.value.err, bytes: tx.serialize().length, unitsConsumed: r.value.unitsConsumed ?? null });
  }

  // 2. Step 3 against a live, not-yet-graduated, SOL-paired Pump curve.
  const g = b.decodePumpGlobal(Buffer.from((await retry(() => conn.getAccountInfo(new PublicKey(b.pumpGlobalAddress()))))!.data))!;
  const feeBps = b.freshCurveFeeBps(Buffer.from((await retry(() => conn.getAccountInfo(new PublicKey(b.pumpFeeConfigAddress()))))!.data))!;
  const sigs = await retry(() => conn.getSignaturesForAddress(PUMP, { limit: 60 }));
  let devBuy: Record<string, unknown> = { skipped: "no live curve found; rerun" };
  outer: for (const s of sigs) {
    if (s.err) continue;
    const tx = await retry(() => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })).catch(() => null);
    const keys = tx?.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat() ?? [];
    for (const m of keys) {
      const curveAddr = new PublicKey(b.bondingCurveAddress(m.toBase58()));
      if (!keys.some((k) => k.equals(curveAddr))) continue;
      const acct = await retry(() => conn.getAccountInfo(curveAddr));
      const mintAcct = await retry(() => conn.getAccountInfo(m));
      if (!acct || !mintAcct || !mintAcct.owner.equals(TOKEN_2022)) continue;
      const info = decodeBondingCurve(Buffer.from(acct.data));
      const reserves = b.decodeCurveReserves(Buffer.from(acct.data));
      if (!info || !reserves || info.complete || info.isHolderReward || (info.quoteMint && info.quoteMint !== "So11111111111111111111111111111111111111112")) continue;
      const lamports = 10_000_000n;
      const expected = b.tokensOutAtReserves(lamports, reserves, feeBps);
      const build = (minTokensOut: bigint) =>
        b.compileInstructions(payer, blockhash, b.buildDevBuyOnlyInstructions({ mint: m.toBase58(), creator: payer, priorityMicroLamports: 50_000, lamports, minTokensOut, buybackFeeRecipient: g.buybackFeeRecipients[0]! }));
      const ata = PublicKey.findProgramAddressSync([new PublicKey(payer).toBuffer(), TOKEN_2022.toBuffer(), m.toBuffer()], ATA_PROGRAM)[0];
      const okTx = build((expected * 9_700n) / 10_000n);
      const r = await retry(() => conn.simulateTransaction(okTx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: "base64", addresses: [ata.toBase58()] } }));
      const data = r.value.accounts?.[0]?.data?.[0] ? Buffer.from(r.value.accounts[0]!.data[0], "base64") : null;
      const control = await retry(() => conn.simulateTransaction(build(expected * 2n), { sigVerify: false, replaceRecentBlockhash: true }));
      devBuy = {
        coin: m.toBase58(),
        liveReserves: { virtualTokenReserves: reserves.virtualTokenReserves.toString(), virtualQuoteReserves: reserves.virtualQuoteReserves.toString() },
        lamports: lamports.toString(),
        expectedTokens: expected.toString(),
        minTokensOut: ((expected * 9_700n) / 10_000n).toString(),
        ok: r.value.err === null,
        err: r.value.err,
        bytes: okTx.serialize().length,
        unitsConsumed: r.value.unitsConsumed ?? null,
        tokensReceived: data && data.length >= 72 ? data.readBigUInt64LE(64).toString() : null,
        controlMinTooHigh: { err: control.value.err },
      };
      break outer;
    }
  }
  const report = {
    simulatedAt: new Date().toISOString(),
    note: "Read-only simulateTransaction (sigVerify=false). Nothing signed or sent. Fallback step 2 (fee-sharing setup on a live coin, incl. sweep) is evidenced by simulate-launch-setup.ts.",
    simulatedPayer: payer,
    step1CreateOnly: step1,
    step3DevBuy: devBuy,
  };
  const body = JSON.stringify(report, null, 2) + "\n";
  if (out) writeFileSync(out, body);
  console.log(body);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
