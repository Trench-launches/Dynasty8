/**
 * Read-only check of a Squads v4 multisig and its vault (treasury) accounts on mainnet.
 * Signs nothing, sends nothing.
 *
 *   npx tsx --conditions=react-server scripts/verify/check-treasury.ts <multisig> [expectedVault ...]
 *
 * Prints: program owner of the multisig account, threshold, time lock, config authority,
 * members with permissions, the vault PDAs for indexes 0-3 (and which index each expected
 * vault is), each vault's owner / balance / executable flag, and the backend's assessment.
 */
import { Connection, PublicKey } from "@solana/web3.js";

async function main() {
  const [multisigAddr, ...expected] = process.argv.slice(2);
  if (!multisigAddr) throw new Error("usage: check-treasury.ts <multisig> [expectedVault ...]");
  const { readMultisig, assessMultisig, vaultAddress, SQUADS_V4_PROGRAM } = await import("../../src/server/demolition/squads");
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "finalized");

  const acct = await conn.getAccountInfo(new PublicKey(multisigAddr), "finalized");
  const info = await readMultisig(conn, multisigAddr);
  const out: Record<string, unknown> = {
    multisig: multisigAddr,
    accountExists: !!acct,
    accountOwner: acct?.owner.toBase58() ?? null,
    ownedBySquadsV4: acct?.owner.toBase58() === SQUADS_V4_PROGRAM,
  };
  if (!info) {
    console.log(JSON.stringify(out, null, 2));
    throw new Error("Not a Squads v4 multisig account");
  }
  out.threshold = info.threshold;
  out.timeLockSeconds = info.timeLockSeconds;
  out.configAuthority = info.configAuthority;
  out.transactionIndex = info.transactionIndex.toString();
  out.members = info.members;
  out.assessment = assessMultisig(info);

  const vaults: { index: number; address: string; exists: boolean; owner: string | null; lamports: number; executable: boolean; dataLength: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const v = vaultAddress(multisigAddr, i);
    const a = await conn.getAccountInfo(new PublicKey(v), "finalized");
    vaults.push({
      index: i,
      address: v,
      exists: !!a,
      owner: a?.owner.toBase58() ?? null,
      lamports: a?.lamports ?? 0,
      executable: a?.executable ?? false,
      dataLength: a?.data.length ?? 0,
    });
  }
  out.vaults = vaults;
  out.expectedVaults = expected.map((e) => ({ address: e, index: vaults.find((v) => v.address === e)?.index ?? "NOT A VAULT OF THIS MULTISIG (indexes 0-3)" }));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
