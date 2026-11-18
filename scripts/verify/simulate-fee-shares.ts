/**
 * Read-only proof that Pump's fee program accepts a given shareholder set (e.g. the three Squads
 * vaults at 6000 / 2500 / 1500 bps). It SIMULATES `update_fee_shares_v2` against an existing,
 * still-unlocked SharingConfig on mainnet, with signature verification off, so nothing is signed,
 * sent or changed. A control simulation with a broken split (sum != 10000) must fail with
 * InvalidShareTotal, which proves the simulation reaches Pump's validation.
 *
 *   npx tsx --conditions=react-server scripts/verify/simulate-fee-shares.ts [config/treasury.mainnet.json]
 */
import { readFileSync } from "node:fs";
import { sampleWithoutReplacement } from "./sample";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
} from "@solana/web3.js";

const FEES = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const AMM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = new PublicKey("11111111111111111111111111111111");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const UPDATE_FEE_SHARES_V2 = Buffer.from([111, 251, 49, 6, 78, 78, 106, 18]);
const pda = (seeds: (Buffer | PublicKey)[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds.map((s) => (s instanceof PublicKey ? s.toBuffer() : s)), program)[0];
const ata = (owner: PublicKey, mint: PublicKey) => pda([owner, TOKEN, mint], ATA);

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

function encodeShares(holders: { address: string; shareBps: number }[]) {
  const b = Buffer.alloc(8 + 4 + holders.length * 34);
  UPDATE_FEE_SHARES_V2.copy(b, 0);
  b.writeUInt32LE(holders.length, 8);
  holders.forEach((h, i) => {
    new PublicKey(h.address).toBuffer().copy(b, 12 + i * 34);
    b.writeUInt16LE(h.shareBps, 12 + i * 34 + 32);
  });
  return b;
}

async function main() {
  const { decodeSharingConfig, SHARING_CONFIG_DISCRIMINATOR } = await import("../../src/server/demolition/pump-fees");
  const cfgPath = process.argv[2] ?? "config/treasury.mainnet.json";
  const treasury = JSON.parse(readFileSync(cfgPath, "utf8")) as { wallets: { role: string; address: string; shareBps: number }[] };
  const holders = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

  // Unlocked (admin_revoked = 0 at offset 75), active (status = 1 at offset 10) sharing configs.
  const found = await conn.getProgramAccounts(FEES, {
    filters: [
      { memcmp: { offset: 0, bytes: (await import("bs58")).default.encode(SHARING_CONFIG_DISCRIMINATOR) } },
      { memcmp: { offset: 10, bytes: "2" } }, // base58 of byte 1
      { memcmp: { offset: 75, bytes: "1" } }, // base58 of byte 0
    ],
    dataSlice: { offset: 0, length: 0 },
  });
  console.log(`unlocked active sharing configs: ${found.length}`);

  const results: Record<string, unknown>[] = [];
  // The RPC result is read-only: sample from a copy instead of sorting it in place.
  for (const { pubkey } of sampleWithoutReplacement(found, 40)) {
    const acct = await retry(() => conn.getAccountInfo(pubkey));
    const sc = acct && decodeSharingConfig(Buffer.from(acct.data));
    if (!sc || sc.adminRevoked || sc.status !== "ACTIVE" || sc.version === 1) continue;
    const mint = new PublicKey(sc.mint);
    const bondingCurve = pda([Buffer.from("bonding-curve"), mint], PUMP);
    const [admin, bc] = await retry(() => Promise.all([conn.getAccountInfo(new PublicKey(sc.admin)), conn.getAccountInfo(bondingCurve)]));
    if (!admin || admin.lamports < 10_000_000 || !bc || !bc.owner.equals(PUMP)) continue;

    const creatorVault = pda([Buffer.from("creator-vault"), pubkey], PUMP);
    const ammVaultAuth = pda([Buffer.from("creator_vault"), pubkey], AMM);
    const keys: AccountMeta[] = [
      { pubkey: pda([Buffer.from("__event_authority")], FEES), isSigner: false, isWritable: false },
      { pubkey: FEES, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(sc.admin), isSigner: true, isWritable: true },
      { pubkey: pda([Buffer.from("global")], PUMP), isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey, isSigner: false, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: false },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: ata(creatorVault, WSOL), isSigner: false, isWritable: true },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: PUMP, isSigner: false, isWritable: false },
      { pubkey: pda([Buffer.from("__event_authority")], PUMP), isSigner: false, isWritable: false },
      { pubkey: AMM, isSigner: false, isWritable: false },
      { pubkey: pda([Buffer.from("__event_authority")], AMM), isSigner: false, isWritable: false },
      { pubkey: WSOL, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
      { pubkey: ATA, isSigner: false, isWritable: false },
      { pubkey: ammVaultAuth, isSigner: false, isWritable: true },
      { pubkey: ata(ammVaultAuth, WSOL), isSigner: false, isWritable: true },
      // Remaining accounts: the CURRENT shareholders (pending fees are distributed to them first).
      ...sc.shareholders.map((s) => ({ pubkey: new PublicKey(s.address), isSigner: false, isWritable: true })),
    ];
    const simulate = async (h: typeof holders) => {
      const ix = new TransactionInstruction({ programId: FEES, keys, data: encodeShares(h) });
      const msg = new TransactionMessage({
        payerKey: new PublicKey(sc.admin),
        recentBlockhash: (await retry(() => conn.getLatestBlockhash())).blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix],
      }).compileToV0Message();
      const r = await retry(() => conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true }));
      return { err: r.value.err, logs: (r.value.logs ?? []).filter((l) => /Program log: (Instruction|AnchorError|Error)|failed|success/i.test(l)).slice(-6) };
    };
    const ok = await simulate(holders);
    const control = await simulate(holders.map((h, i) => (i === holders.length - 1 ? { ...h, shareBps: h.shareBps - 1 } : h)));
    results.push({ sharingConfig: pubkey.toBase58(), mint: sc.mint, version: sc.version, currentShareholders: sc.shareholders.length, proposed: ok, controlSumNot10000: control });
    if (!ok.err && control.err) break; // conclusive
  }
  console.log(JSON.stringify({ proposedShareholders: holders, simulations: results }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
