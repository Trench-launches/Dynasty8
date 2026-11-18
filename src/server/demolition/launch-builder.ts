import { ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type AccountMeta } from "@solana/web3.js";
import { buildFeeSharingInstructions, type Holder } from "./fee-sharing-setup";
import { PUMP_PROGRAMS } from "./pump-fees";

/**
 * Atomic Pump.fun launch for a Dynasty 8 coin: ONE transaction that
 *   1. create_v2                  (Token-2022 mint, bonding curve; creator = launch wallet)
 *   2. create_fee_sharing_config  (bonding curve creator -> sharing-config PDA)
 *   3. update_fee_shares_v2       (treasury vaults 6000/2500/1500; admin revoked = locked)
 * so creator fees are routed to the treasury from the coin's first trade. Signers: the launch
 * wallet (fee payer, creator) and the new mint keypair. Built unsigned; never sent from here.
 * Layout: pump-fun/pump-public-docs docs/instructions/COIN_CREATION.md, idl/pump.json.
 */
const PUMP = new PublicKey(PUMP_PROGRAMS.pump);
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = new PublicKey("11111111111111111111111111111111");
const MAYHEM = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
export const CREATE_V2 = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);
export const PUMP_NAME_MAX = 32;
export const PUMP_SYMBOL_MAX = 13;
export const PUMP_URI_MAX = 200;
/** Compute for create_v2 + fee-sharing setup (simulated about 0.2M); generous headroom. */
export const LAUNCH_COMPUTE_UNITS = 600_000;

const pda = (seeds: (Buffer | PublicKey)[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds.map((s) => (s instanceof PublicKey ? s.toBuffer() : s)), program)[0];
const ata = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => pda([owner, tokenProgram, mint], ATA_PROGRAM);

function borshString(s: string) {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

export interface CoinMetadataArgs {
  name: string;
  symbol: string;
  uri: string;
}

export function validateCoinArgs(a: CoinMetadataArgs): string[] {
  const issues: string[] = [];
  if (!a.name || [...a.name].length > PUMP_NAME_MAX) issues.push(`name must be 1-${PUMP_NAME_MAX} characters`);
  if (!a.symbol || [...a.symbol].length > PUMP_SYMBOL_MAX) issues.push(`symbol must be 1-${PUMP_SYMBOL_MAX} characters`);
  if (!/^https:\/\/\S+$/.test(a.uri) || a.uri.length > PUMP_URI_MAX) issues.push(`uri must be an https URL of at most ${PUMP_URI_MAX} characters`);
  return issues;
}

/** create_v2 for a SOL-paired, non-mayhem, non-holder-rewards coin. Trailing optional args omitted (= false/0). */
export function buildCreateV2Instruction(p: CoinMetadataArgs & { mint: string; user: string; creator: string }): TransactionInstruction {
  const mint = new PublicKey(p.mint);
  const user = new PublicKey(p.user);
  const bondingCurve = pda([Buffer.from("bonding-curve"), mint], PUMP);
  const solVault = pda([Buffer.from("sol-vault")], MAYHEM);
  const keys: AccountMeta[] = [
    { pubkey: mint, isSigner: true, isWritable: true },
    { pubkey: pda([Buffer.from("mint-authority")], PUMP), isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: ata(bondingCurve, mint, TOKEN_2022), isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("global")], PUMP), isSigner: false, isWritable: false },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: SYSTEM, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: MAYHEM, isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("global-params")], MAYHEM), isSigner: false, isWritable: false },
    { pubkey: solVault, isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("mayhem-state"), mint], MAYHEM), isSigner: false, isWritable: true },
    { pubkey: ata(solVault, mint, TOKEN_2022), isSigner: false, isWritable: true },
    { pubkey: pda([Buffer.from("__event_authority")], PUMP), isSigner: false, isWritable: false },
    { pubkey: PUMP, isSigner: false, isWritable: false },
  ];
  const data = Buffer.concat([
    CREATE_V2,
    borshString(p.name),
    borshString(p.symbol),
    borshString(p.uri),
    new PublicKey(p.creator).toBuffer(),
    Buffer.from([0]), // is_mayhem_mode = false
  ]);
  return new TransactionInstruction({ programId: PUMP, keys, data });
}

/** All instructions of the atomic launch, in order. */
export function buildLaunchInstructions(p: CoinMetadataArgs & { mint: string; creator: string; holders: Holder[] }): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: LAUNCH_COMPUTE_UNITS }),
    buildCreateV2Instruction({ ...p, user: p.creator }),
    ...buildFeeSharingInstructions({ mint: p.mint, creator: p.creator, holders: p.holders, existing: null, sweep: false }),
  ];
}

/** Compiles the launch to an unsigned v0 transaction (optionally through address lookup tables). */
export function compileLaunch(
  p: CoinMetadataArgs & { mint: string; creator: string; holders: Holder[]; blockhash: string; lookupTables?: AddressLookupTableAccount[] },
): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: new PublicKey(p.creator), recentBlockhash: p.blockhash, instructions: buildLaunchInstructions(p) }).compileToV0Message(p.lookupTables ?? []);
  return new VersionedTransaction(msg);
}

/**
 * Accounts that are identical for every Dynasty 8 launch: programs, Pump/Pump-Fees/AMM globals and
 * event authorities, the Mayhem accounts and WSOL (the treasury vaults travel as instruction data,
 * not accounts). These are what an
 * address lookup table should hold so the atomic launch fits in one transaction.
 */
export function staticLaunchAccounts(holders: Holder[]): string[] {
  const probe = buildLaunchInstructions({ name: "X", symbol: "X", uri: "https://x", mint: PublicKey.default.toBase58(), creator: PublicKey.default.toBase58(), holders });
  const dynamic = new Set<string>();
  // Anything derived from the mint or the creator is per-launch; probe twice and keep what is stable.
  const probe2 = buildLaunchInstructions({ name: "X", symbol: "X", uri: "https://x", mint: SYSTEM.toBase58(), creator: MAYHEM.toBase58(), holders });
  const keys = (ixs: TransactionInstruction[]) => ixs.flatMap((ix) => [ix.programId.toBase58(), ...ix.keys.map((k) => k.pubkey.toBase58())]);
  const a = new Set(keys(probe));
  const b = new Set(keys(probe2));
  for (const k of a) if (!b.has(k)) dynamic.add(k);
  return [...a].filter((k) => !dynamic.has(k) && k !== PublicKey.default.toBase58() && k !== ComputeBudgetProgram.programId.toBase58());
}
