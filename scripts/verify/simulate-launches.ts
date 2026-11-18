/**
 * Read-only proof of the ATOMIC launch for every coin in config/launch/*.mainnet.json:
 *   create_v2 -> create_fee_sharing_config -> update_fee_shares_v2 (treasury 6000/2500/1500)
 * in ONE transaction, SIMULATED on mainnet with a fresh mint per coin and signature verification
 * off. Nothing is signed, sent or created.
 *
 * The real launch needs a project address lookup table (the transaction is too large without
 * one). For simulation only, this borrows an existing lookup table already on-chain that holds
 * Pump's fixed accounts (found in recent Pump create transactions); a test lookup table is never
 * created here. A control simulation with a broken split must fail with InvalidShareTotal (6014).
 *
 *   npx tsx --conditions=react-server scripts/verify/simulate-launches.ts [--out docs/launch/simulation-report.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, type AddressLookupTableAccount } from "@solana/web3.js";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const CREATE_V2_B58_PREFIX = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

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
  const { compileLaunch, staticLaunchAccounts } = await import("../../src/server/demolition/launch-builder");
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as { wallets: { role: string; address: string; shareBps: number }[] };
  const holders = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
  const dynasty = JSON.parse(readFileSync("config/launch/dynasty.mainnet.json", "utf8")).coin;
  const props = JSON.parse(readFileSync("config/launch/properties.mainnet.json", "utf8")).coins;
  const coins = [dynasty, ...props] as { slug: string; name: string; symbol: string }[];
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const statics = new Set(staticLaunchAccounts(holders));

  // 1. Collect lookup tables from recent Pump transactions (creates or trades) and funded payers.
  const sigs = await retry(() => conn.getSignaturesForAddress(PUMP, { limit: 200 }));
  const altKeys = new Set<string>();
  const payers = new Set<string>();
  for (const s of sigs) {
    if (s.err || altKeys.size >= 25) continue;
    const tx = await retry(() => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })).catch(() => null);
    if (!tx || !("addressTableLookups" in tx.transaction.message)) continue;
    const msg = tx.transaction.message;
    const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat();
    const isCreate = msg.compiledInstructions.some((ix) => keys[ix.programIdIndex]?.equals(PUMP) && Buffer.from(ix.data.subarray(0, 8)).equals(CREATE_V2_B58_PREFIX));
    for (const l of msg.addressTableLookups) altKeys.add(l.accountKey.toBase58());
    if (isCreate) payers.add(keys[0]!.toBase58());
    else if (payers.size < 5) payers.add(keys[0]!.toBase58());
  }
  const alts: AddressLookupTableAccount[] = [];
  for (const k of altKeys) {
    const r = await retry(() => conn.getAddressLookupTable(new PublicKey(k)));
    if (r.value?.isActive()) alts.push(r.value);
  }
  const coverage = (a: AddressLookupTableAccount) => a.state.addresses.filter((x) => statics.has(x.toBase58())).length;
  alts.sort((a, b) => coverage(b) - coverage(a));
  const alt = alts[0];
  if (!alt) throw new Error("No active lookup table found in recent Pump transactions; rerun");
  let payer: string | null = null;
  for (const p of payers) {
    const a = await retry(() => conn.getAccountInfo(new PublicKey(p)));
    if (a && a.lamports > 100_000_000) {
      payer = p;
      break;
    }
  }
  if (!payer) throw new Error("No funded payer among recent creators; rerun");

  // 2. Simulate the atomic launch for each coin (fresh mint), plus one broken-split control.
  const results = [];
  for (const c of coins) {
    const mint = Keypair.generate().publicKey.toBase58();
    const uri = `https://dynasty15.xyz/launch/metadata/${c.slug}.json`;
    const sim = async (h: typeof holders) => {
      const tx = compileLaunch({ name: c.name, symbol: c.symbol, uri, mint, creator: payer!, holders: h, blockhash: (await retry(() => conn.getLatestBlockhash())).blockhash, lookupTables: [alt] });
      const bytes = tx.serialize().length;
      const r = await retry(() => conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }));
      const logs = r.value.logs ?? [];
      return { ok: r.value.err === null, err: r.value.err, bytes, unitsConsumed: r.value.unitsConsumed ?? null, steps: logs.filter((l) => /Instruction: (CreateV2|CreateFeeSharingConfig|UpdateFeeSharesV2)/.test(l)).map((l) => l.replace("Program log: Instruction: ", "")), failure: logs.filter((l) => /AnchorError|failed/.test(l)).slice(-1)[0] ?? null };
    };
    results.push({ symbol: c.symbol, name: c.name, ...(await sim(holders)) });
  }
  const control = await (async () => {
    const c = coins[1]!;
    const tx = compileLaunch({ name: c.name, symbol: c.symbol, uri: `https://dynasty15.xyz/launch/metadata/${c.slug}.json`, mint: Keypair.generate().publicKey.toBase58(), creator: payer!, holders: holders.map((h, i) => (i === 2 ? { ...h, shareBps: h.shareBps - 1 } : h)), blockhash: (await retry(() => conn.getLatestBlockhash())).blockhash, lookupTables: [alt] });
    const r = await retry(() => conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }));
    return { err: r.value.err, failure: (r.value.logs ?? []).filter((l) => /AnchorError/.test(l)).slice(-1)[0] ?? null };
  })();
  const report = {
    simulatedAt: new Date().toISOString(),
    cluster: "mainnet-beta",
    note: "Read-only simulateTransaction with sigVerify=false and fresh mints. Nothing was signed, sent or created. The lookup table was borrowed from a recent Pump transaction for simulation only.",
    shareholders: holders,
    lookupTable: { address: alt.key.toBase58(), staticAccountsCovered: coverage(alt), staticAccountsNeeded: statics.size },
    simulatedPayer: payer,
    allOk: results.every((r) => r.ok),
    results,
    controlBrokenSplit: control,
  };
  const body = JSON.stringify(report, null, 2) + "\n";
  if (out) writeFileSync(out, body);
  console.log(body);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
