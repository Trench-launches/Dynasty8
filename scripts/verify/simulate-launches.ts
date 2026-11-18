/**
 * Read-only proof of the ATOMIC launch for every coin in config/launch/*.mainnet.json, SIMULATED on
 * mainnet with a fresh mint per coin and signature verification off. Nothing is signed, sent or
 * created.
 *
 *   create_v2 -> create_fee_sharing_config -> update_fee_shares_v2 (locked) [-> 0.01 SOL dev buy]
 *
 * Property coins: FUND 6000 / ECOSYSTEM 2500 / OPERATIONS 1500. $DYNASTY (Option C): FUND 10000.
 *
 * The real launch uses the project's own address lookup table (statics + the launch wallet's
 * accounts). No such table exists yet and none is created here, so the simulation borrows lookup
 * tables already on-chain from recent Pump transactions, and simulates as a recent Pump trader whose
 * own lookup tables cover its wallet accounts (needed only for the dev-buy variant to fit). Controls
 * with a broken split and an unbalanced single shareholder must fail with InvalidShareTotal (6014).
 *
 *   npx tsx --conditions=react-server scripts/verify/simulate-launches.ts [--out docs/launch/simulation-report.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, type AddressLookupTableAccount } from "@solana/web3.js";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const DEV_BUY = 10_000_000n; // 0.01 SOL
const BONDING_CURVE_FEE_BPS = 125; // protocol 95 + creator 30 (docs/launch/fee-tiers.json)

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

type Holder = { address: string; shareBps: number };

async function main() {
  const b = await import("../../src/server/demolition/launch-builder");
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as { wallets: { role: string; address: string; shareBps: number }[] };
  const propertyHolders: Holder[] = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
  const nativeHolders: Holder[] = [{ address: treasury.wallets.find((w) => w.role === "FUND")!.address, shareBps: 10_000 }];
  const dynasty = JSON.parse(readFileSync("config/launch/dynasty.mainnet.json", "utf8")).coin;
  const props = JSON.parse(readFileSync("config/launch/properties.mainnet.json", "utf8")).coins;
  const coins = [dynasty, ...props] as { slug: string; kind: string; name: string; symbol: string; feeSharing: { shareholders: Holder[] } }[];
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const globalPda = PublicKey.findProgramAddressSync([Buffer.from("global")], PUMP)[0];
  const g = b.decodePumpGlobal(Buffer.from((await retry(() => conn.getAccountInfo(globalPda)))!.data))!;
  const recipient = g.buybackFeeRecipients[0]!;
  const minOut = (b.expectedTokensOut(DEV_BUY, g, BONDING_CURVE_FEE_BPS) * 97n) / 100n;

  // 1. Recent Pump transactions that use lookup tables: collect the tables and (payer -> tables).
  const sigs = await retry(() => conn.getSignaturesForAddress(PUMP, { limit: 150 }));
  const byPayer = new Map<string, Set<string>>();
  for (const s of sigs) {
    if (s.err || byPayer.size >= 15) continue;
    const tx = await retry(() => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })).catch(() => null);
    if (!tx || !("addressTableLookups" in tx.transaction.message) || !tx.transaction.message.addressTableLookups.length) continue;
    const payer = tx.transaction.message.staticAccountKeys[0]!.toBase58();
    const set = byPayer.get(payer) ?? new Set<string>();
    for (const l of tx.transaction.message.addressTableLookups) set.add(l.accountKey.toBase58());
    byPayer.set(payer, set);
  }
  const tableCache = new Map<string, AddressLookupTableAccount | null>();
  const table = async (k: string) => {
    if (!tableCache.has(k)) tableCache.set(k, await retry(() => conn.getAddressLookupTable(new PublicKey(k))).then((r) => (r.value?.isActive() ? r.value : null)).catch(() => null));
    return tableCache.get(k)!;
  };
  for (const set of byPayer.values()) for (const k of set) await table(k);
  const allTables = [...tableCache.values()].filter((t): t is AddressLookupTableAccount => !!t);

  const build = (holders: Holder[], devBuy: boolean, payer: string, lts: AddressLookupTableAccount[], mint: string, c: { name: string; symbol: string; slug: string }, minTokensOut = minOut) =>
    b.compileLaunch({
      name: c.name,
      symbol: c.symbol,
      uri: uriFor(c.slug),
      mint,
      creator: payer,
      holders,
      blockhash: PublicKey.default.toBase58(),
      lookupTables: lts,
      devBuy: devBuy ? { lamports: DEV_BUY, minTokensOut, buybackFeeRecipient: recipient } : undefined,
    });
  // A CIDv0 gateway URL has the production length (67 characters).
  const uriFor = (slug: string) => `https://ipfs.io/ipfs/Qm${slug.replace(/[^a-z]/g, "").padEnd(44, "x").slice(0, 44)}`;

  // Greedy: smallest set of tables that makes the transaction fit.
  const fit = (make: (lts: AddressLookupTableAccount[]) => ReturnType<typeof b.compileLaunch>, pool: AddressLookupTableAccount[]) => {
    const chosen: AddressLookupTableAccount[] = [];
    const size = (lts: AddressLookupTableAccount[]) => {
      try {
        return make(lts).serialize().length;
      } catch {
        return Infinity;
      }
    };
    let cur = size(chosen);
    for (let round = 0; round < 4 && cur > 1232; round++) {
      let best: AddressLookupTableAccount | null = null;
      let bestSize = cur;
      for (const t of pool) {
        if (chosen.includes(t)) continue;
        const s = size([...chosen, t]);
        if (s < bestSize) {
          best = t;
          bestSize = s;
        }
      }
      if (!best) break;
      chosen.push(best);
      cur = bestSize;
    }
    return { tables: chosen, bytes: cur };
  };

  // 2. A funded simulated payer for which the longest property coin with dev buy fits.
  const longest = coins.reduce((a, c) => (c.name.length > a.name.length ? c : a));
  let payer: string | null = null;
  for (const [p] of byPayer) {
    const acct = await retry(() => conn.getAccountInfo(new PublicKey(p)));
    if (!acct || acct.lamports < 200_000_000 || !acct.owner.equals(new PublicKey("11111111111111111111111111111111"))) continue;
    const f = fit((lts) => build(propertyHolders, true, p, lts, Keypair.generate().publicKey.toBase58(), longest), allTables);
    if (f.bytes <= 1232) {
      payer = p;
      break;
    }
  }
  if (!payer) throw new Error("No funded recent Pump trader whose borrowed lookup tables make the dev-buy variant fit; rerun");

  // 3. Simulate every coin, with and without the dev buy, plus controls.
  const payerBalance = await retry(() => conn.getBalance(new PublicKey(payer!)));
  const simulate = async (holders: Holder[], devBuy: boolean, c: { name: string; symbol: string; slug: string }, minTokensOut = minOut) => {
    const mint = Keypair.generate().publicKey.toBase58();
    const f = fit((lts) => build(holders, devBuy, payer!, lts, mint, c, minTokensOut), allTables);
    if (f.bytes > 1232) return { ok: false, bytes: f.bytes, reason: "does not fit with the borrowed tables" };
    const tx = build(holders, devBuy, payer!, f.tables, mint, c, minTokensOut);
    const userAta = PublicKey.findProgramAddressSync([new PublicKey(payer!).toBuffer(), TOKEN_2022.toBuffer(), new PublicKey(mint).toBuffer()], ATA_PROGRAM)[0];
    const r = await retry(() => conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: "base64", addresses: [payer!, userAta.toBase58()] } }));
    const logs = r.value.logs ?? [];
    const after = r.value.accounts?.[0]?.lamports ?? null;
    const ataData = r.value.accounts?.[1]?.data?.[0] ? Buffer.from(r.value.accounts[1]!.data[0], "base64") : null;
    return {
      ok: r.value.err === null,
      err: r.value.err,
      bytes: tx.serialize().length,
      lookupTablesUsed: f.tables.length,
      unitsConsumed: r.value.unitsConsumed ?? null,
      payerCostLamports: after === null ? null : payerBalance - after,
      tokensReceived: ataData && ataData.length >= 72 ? ataData.readBigUInt64LE(64).toString() : null,
      steps: logs.filter((l) => /Instruction: (CreateV2|CreateFeeSharingConfig|UpdateFeeSharesV2|BuyExactQuoteInV3|CreateIdempotent)/.test(l)).map((l) => l.replace("Program log: Instruction: ", "")),
      failure: logs.filter((l) => /AnchorError|failed/.test(l)).slice(-1)[0] ?? null,
    };
  };
  const results = [];
  for (const c of coins) {
    const holders = c.kind === "NATIVE" ? nativeHolders : propertyHolders;
    const configMatches = JSON.stringify(c.feeSharing.shareholders.map((h) => [h.address, h.shareBps])) === JSON.stringify(holders.map((h) => [h.address, h.shareBps]));
    results.push({ symbol: c.symbol, kind: c.kind, shareholders: holders, configMatches, launchOnly: await simulate(holders, false, c), launchWithDevBuy: await simulate(holders, true, c) });
  }
  const controls = {
    propertyBrokenSplit: await simulate(propertyHolders.map((h, i) => (i === 2 ? { ...h, shareBps: h.shareBps - 1 } : h)), false, coins[1]!),
    dynastyNot10000: await simulate([{ ...nativeHolders[0]!, shareBps: 9_999 }], false, coins[0]!),
    devBuyMinTokensTooHigh: await simulate(propertyHolders, true, coins[1]!, minOut * 2n),
  };
  const report = {
    simulatedAt: new Date().toISOString(),
    cluster: "mainnet-beta",
    note: "Read-only simulateTransaction (sigVerify=false, fresh mints). Nothing was signed, sent or created. Lookup tables were borrowed from recent Pump transactions and the payer is a recent Pump trader, for simulation only; production uses the project's own lookup table and the dedicated launch wallet.",
    devBuyLamports: DEV_BUY.toString(),
    expectedTokensForDevBuy: b.expectedTokensOut(DEV_BUY, g, BONDING_CURVE_FEE_BPS).toString(),
    minTokensOut: minOut.toString(),
    buybackFeeRecipient: recipient,
    simulatedPayer: payer,
    allOk: results.every((r) => r.configMatches && r.launchOnly.ok && r.launchWithDevBuy.ok),
    results,
    controls,
  };
  const body = JSON.stringify(report, null, 2) + "\n";
  if (out) writeFileSync(out, body);
  console.log(body);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
