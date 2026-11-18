/**
 * Read-only proof of the post-launch fee-sharing transaction used by /admin/treasury:
 * create_fee_sharing_config + update_fee_shares_v2 (the three treasury vaults, 6000/2500/1500),
 * SIMULATED on a real, recently created Pump coin that has no sharing config yet, as if its
 * creator signed. Signature verification is off; nothing is signed, sent or changed.
 *
 *   npx tsx --conditions=react-server scripts/verify/simulate-launch-setup.ts [config/treasury.mainnet.json]
 */
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
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
  const { buildFeeSharingInstructions, decodeBondingCurve } = await import("../../src/server/demolition/fee-sharing-setup");
  const { sharingConfigAddress } = await import("../../src/server/demolition/pump-fees");
  const treasury = JSON.parse(readFileSync(process.argv[2] ?? "config/treasury.mainnet.json", "utf8")) as { wallets: { address: string; shareBps: number }[] };
  const holders = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

  const sigs = await retry(() => conn.getSignaturesForAddress(PUMP, { limit: 60 }));
  const seen = new Set<string>();
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await retry(() => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })).catch(() => null);
    const keys = tx?.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat() ?? [];
    const infos = keys.length ? await retry(() => conn.getMultipleAccountsInfo(keys.slice(0, 100))) : [];
    for (const [i, k] of keys.slice(0, 100).entries()) {
      const info = infos[i];
      if (!info || !info.owner.equals(PUMP) || info.data.length < 81) continue;
      const bc = decodeBondingCurve(Buffer.from(info.data));
      if (!bc || bc.complete || bc.isHolderReward || (bc.quoteMint && bc.quoteMint !== "So11111111111111111111111111111111111111112") || seen.has(k.toBase58())) continue;
      seen.add(k.toBase58());
      // Find the mint whose bonding-curve PDA is k among this tx's keys.
      const mint = keys.find((m) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), m.toBuffer()], PUMP)[0].equals(k));
      if (!mint) continue;
      if (await retry(() => conn.getAccountInfo(new PublicKey(sharingConfigAddress(mint.toBase58()))))) continue; // already has fee sharing
      const creator = await retry(() => conn.getAccountInfo(new PublicKey(bc.creator)));
      if (!creator || creator.lamports < 20_000_000) continue; // needs rent for the 1 KB config
      const sim = async (h: typeof holders) => {
        const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...buildFeeSharingInstructions({ mint: mint.toBase58(), creator: bc.creator, holders: h, existing: null, sweep: bc.pendingCreatorFee > 0n })];
        const msg = new TransactionMessage({ payerKey: new PublicKey(bc.creator), recentBlockhash: (await retry(() => conn.getLatestBlockhash())).blockhash, instructions: all }).compileToV0Message();
        const r = await retry(() => conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true }));
        return { err: r.value.err, unitsConsumed: r.value.unitsConsumed, logs: (r.value.logs ?? []).filter((l) => /Instruction:|AnchorError|failed|success/.test(l)).slice(-8) };
      };
      const ok = await sim(holders);
      const control = await sim(holders.map((h, i) => (i === 2 ? { ...h, shareBps: h.shareBps - 1 } : h)));
      console.log(JSON.stringify({ mint: mint.toBase58(), creator: bc.creator, pendingCreatorFee: bc.pendingCreatorFee.toString(), sharingConfig: sharingConfigAddress(mint.toBase58()), holders, proposed: ok, controlSumNot10000: control }, null, 2));
      if (!ok.err && control.err) return;
    }
  }
  console.log("no suitable fresh coin found in the sampled transactions; rerun");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
