/** Bounded read-only search for a non-zero Pump distribute payout among sampled sharing configs. */
import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { createRpcChainReader, lamportDelta } from "../../src/server/demolition/chain";
import { distributeEventsIn, sharingConfigAddress } from "../../src/server/demolition/pump-fees";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "finalized");
const reader = createRpcChainReader(RPC);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const { addresses } = JSON.parse(readFileSync(new URL("./sample-sharing-configs.json", import.meta.url), "utf8")) as { addresses: string[] };
let fetched = 0;
(async () => {
  for (const cfg of addresses) {
    if (fetched > 350) break;
    await sleep(200);
    const sigs = await conn.getSignaturesForAddress(new PublicKey(cfg), { limit: 40 }).catch(() => []);
    for (const s of sigs) {
      if (s.err || fetched > 350) continue;
      await sleep(180);
      fetched++;
      const tx = await reader.getTransaction(s.signature).catch(() => null);
      if (!tx) continue;
      for (const e of distributeEventsIn(tx)) {
        if (e.distributed === 0n) continue;
        const holders = e.shareholders.map((h) => {
          const share = (e.distributed * BigInt(h.shareBps)) / 10_000n;
          const delta = lamportDelta(tx, h.address) + (tx.accountKeys[0] === h.address ? tx.fee : 0n);
          return { address: h.address, shareBps: h.shareBps, share: share.toString(), lamportDelta: delta.toString(), covered: delta >= share };
        });
        console.log(JSON.stringify({ signature: s.signature, mint: e.mint, pda: e.sharingConfig === sharingConfigAddress(e.mint), quoteMint: e.quoteMint, distributed: e.distributed.toString(), holders }, null, 2));
        console.log(`fetched ${fetched} transactions`);
        process.exit(0);
      }
    }
  }
  console.log(`no non-zero distribute found in ${fetched} transactions`);
})();
