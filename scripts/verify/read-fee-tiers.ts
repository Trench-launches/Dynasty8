/**
 * Read-only: Pump's live creator-fee schedule. Reads the Pump Fees program's FeeConfig for the
 * Pump (bonding curve) program and, if present, for PumpSwap, and prints each market-cap tier's
 * LP / protocol / creator fee in basis points. SOL-paired coins always use this schedule
 * (create_v2's creator_fee_bps is ignored for SOL and USDC pairs). Nothing is signed or sent.
 *
 *   npx tsx --conditions=react-server scripts/verify/read-fee-tiers.ts [--out docs/launch/fee-tiers.json]
 */
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const FEES = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const PROGRAMS = { pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", pumpSwap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA" };
const DISC = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);

function decode(d: Buffer) {
  if (!d.subarray(0, 8).equals(DISC)) return null;
  let o = 8 + 1 + 32; // discriminator, bump, admin
  const fees = () => {
    const f = { lpFeeBps: Number(d.readBigUInt64LE(o)), protocolFeeBps: Number(d.readBigUInt64LE(o + 8)), creatorFeeBps: Number(d.readBigUInt64LE(o + 16)) };
    o += 24;
    return f;
  };
  const tiers = () => {
    const n = d.readUInt32LE(o);
    o += 4;
    return Array.from({ length: n }, () => {
      const lo = d.readBigUInt64LE(o);
      const hi = d.readBigUInt64LE(o + 8);
      o += 16;
      const threshold = (hi << 64n) + lo;
      return { marketCapThresholdSol: Number(threshold) / 1e9, ...fees() };
    });
  };
  const flatFees = fees();
  const feeTiers = tiers();
  const stableFeeTiers = o < d.length ? tiers() : [];
  return { flatFees, feeTiers, stableFeeTiers };
}

async function main() {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const result: Record<string, unknown> = { readAt: new Date().toISOString(), cluster: "mainnet-beta" };
  for (const [name, program] of Object.entries(PROGRAMS)) {
    const pda = PublicKey.findProgramAddressSync([Buffer.from("fee_config"), new PublicKey(program).toBuffer()], FEES)[0];
    const a = await conn.getAccountInfo(pda);
    result[name] = a ? { feeConfig: pda.toBase58(), ...decode(Buffer.from(a.data)) } : { feeConfig: pda.toBase58(), missing: true };
  }
  const body = JSON.stringify(result, null, 2) + "\n";
  if (out) writeFileSync(out, body);
  console.log(body);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
