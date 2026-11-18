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

// ── Initial (dev) buy ────────────────────────────────────────────────────────

const SPL_TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const FEES = new PublicKey(PUMP_PROGRAMS.fees);
/** Pump `buy_exact_quote_in_v3`: spend exactly `spendable_quote_in`, receive at least `min_tokens_out`. */
export const BUY_EXACT_QUOTE_IN_V3 = Buffer.from([225, 247, 80, 30, 213, 179, 132, 136]);

export interface PumpGlobalInfo {
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  buybackFeeRecipients: string[];
}

/**
 * Pump Global (idl/pump.json field order): 8 discriminator, initialized u8, authority, fee_recipient,
 * initial_virtual_token_reserves u64 @73, initial_virtual_sol_reserves u64 @81, ..., and
 * buyback_fee_recipients [pubkey; 8] @741.
 */
export function decodePumpGlobal(data: Buffer): PumpGlobalInfo | null {
  if (data.length < 741 + 8 * 32) return null;
  return {
    initialVirtualTokenReserves: data.readBigUInt64LE(73),
    initialVirtualSolReserves: data.readBigUInt64LE(81),
    buybackFeeRecipients: Array.from({ length: 8 }, (_, i) => new PublicKey(data.subarray(741 + i * 32, 773 + i * 32)).toBase58()),
  };
}

/**
 * Tokens a buy of `lamports` (fees included) gets on a FRESH curve. Inside the atomic launch nobody
 * can trade first, so this is deterministic; the fee is taken from the SOL in.
 */
export function expectedTokensOut(lamports: bigint, g: PumpGlobalInfo, totalFeeBps: number): bigint {
  const net = (lamports * 10_000n) / (10_000n + BigInt(totalFeeBps));
  return (net * g.initialVirtualTokenReserves) / (g.initialVirtualSolReserves + net);
}

export interface DevBuy {
  lamports: bigint;
  minTokensOut: bigint;
  buybackFeeRecipient: string;
}

/** Creates the buyer token account (idempotent) and buys with exactly `lamports`. */
export function buildDevBuyInstructions(p: { mint: string; user: string } & DevBuy): TransactionInstruction[] {
  const mint = new PublicKey(p.mint);
  const user = new PublicKey(p.user);
  const bondingCurve = pda([Buffer.from("bonding-curve"), mint], PUMP);
  const userAta = ata(user, mint, TOKEN_2022);
  const createAta = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
  const data = Buffer.alloc(8 + 8 + 8);
  BUY_EXACT_QUOTE_IN_V3.copy(data, 0);
  data.writeBigUInt64LE(p.lamports, 8);
  data.writeBigUInt64LE(p.minTokensOut, 16);
  const buy = new TransactionInstruction({
    programId: PUMP,
    keys: [
      { pubkey: pda([Buffer.from("global")], PUMP), isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: WSOL, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: ata(bondingCurve, mint, TOKEN_2022), isSigner: false, isWritable: true },
      { pubkey: ata(bondingCurve, WSOL, SPL_TOKEN), isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: ata(user, WSOL, SPL_TOKEN), isSigner: false, isWritable: true },
      { pubkey: pda([Buffer.from("user_volume_accumulator"), user], PUMP), isSigner: false, isWritable: true },
      { pubkey: pda([Buffer.from("fee_config"), PUMP], FEES), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(p.buybackFeeRecipient), isSigner: false, isWritable: true },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: pda([Buffer.from("__event_authority")], PUMP), isSigner: false, isWritable: false },
      { pubkey: PUMP, isSigner: false, isWritable: false },
    ],
    data,
  });
  return [createAta, buy];
}

/** Default priority fee: 50,000 micro-lamports per CU (about 0.00004 SOL at 800k CU). Phantom may adjust it. */
export const DEFAULT_PRIORITY_MICROLAMPORTS = 50_000;
/** Compute for create + fee sharing + dev buy (simulated about 0.35M); headroom included. */
export const LAUNCH_WITH_BUY_COMPUTE_UNITS = 800_000;

export interface LaunchParams extends CoinMetadataArgs {
  mint: string;
  creator: string;
  holders: Holder[];
  devBuy?: DevBuy;
  priorityMicroLamports?: number;
}

/** All instructions of the atomic launch, in order: create, fee-sharing config, locked shares, dev buy. */
export function buildLaunchInstructions(p: LaunchParams): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: p.devBuy ? LAUNCH_WITH_BUY_COMPUTE_UNITS : LAUNCH_COMPUTE_UNITS }),
    ...(p.priorityMicroLamports ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.priorityMicroLamports })] : []),
    buildCreateV2Instruction({ ...p, user: p.creator }),
    ...buildFeeSharingInstructions({ mint: p.mint, creator: p.creator, holders: p.holders, existing: null, sweep: false }),
    ...(p.devBuy ? buildDevBuyInstructions({ mint: p.mint, user: p.creator, ...p.devBuy }) : []),
  ];
}

/** Compiles the launch to an unsigned v0 transaction (optionally through address lookup tables). */
export function compileLaunch(p: LaunchParams & { blockhash: string; lookupTables?: AddressLookupTableAccount[] }): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: new PublicKey(p.creator), recentBlockhash: p.blockhash, instructions: buildLaunchInstructions(p) }).compileToV0Message(p.lookupTables ?? []);
  return new VersionedTransaction(msg);
}

/**
 * Accounts an address lookup table should hold so the atomic launch (with dev buy) fits in one
 * transaction: everything identical across launches (programs, Pump / Pump Fees / AMM globals and
 * event authorities, Mayhem accounts, WSOL, the fee config, the buyback fee recipient) plus, when
 * `launchWallet` is given, the dedicated launch wallet's own non-signer accounts (its WSOL account
 * and Pump volume accumulator). The treasury vaults are instruction data, not accounts. Signers
 * (launch wallet, mint) can never come from a lookup table.
 */
export function staticLaunchAccounts(holders: Holder[], opts: { buybackFeeRecipient?: string; launchWallet?: string } = {}): string[] {
  const devBuy = opts.buybackFeeRecipient ? { lamports: 1n, minTokensOut: 1n, buybackFeeRecipient: opts.buybackFeeRecipient } : undefined;
  const keys = (mint: string, creator: string) =>
    buildLaunchInstructions({ name: "X", symbol: "X", uri: "https://x", mint, creator, holders, devBuy }).flatMap((ix) => [ix.programId.toBase58(), ...ix.keys.map((k) => k.pubkey.toBase58())]);
  // Anything derived from the mint or the creator differs between two probes; keep what is stable.
  const a = keys(PublicKey.default.toBase58(), PublicKey.default.toBase58());
  const b = new Set(keys(SYSTEM.toBase58(), MAYHEM.toBase58()));
  const out = [...new Set(a)].filter((k) => b.has(k) && k !== PublicKey.default.toBase58() && k !== ComputeBudgetProgram.programId.toBase58());
  if (opts.launchWallet && devBuy) {
    const w = new PublicKey(opts.launchWallet);
    for (const k of [ata(w, WSOL, SPL_TOKEN), pda([Buffer.from("user_volume_accumulator"), w], PUMP)]) if (!out.includes(k.toBase58())) out.push(k.toBase58());
  }
  return out;
}

/** Pump Fees FeeConfig account discriminator. */
export const FEE_CONFIG_DISCRIMINATOR = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);

/**
 * Total trade fee (LP + protocol + creator, in bps) a fresh bonding curve pays, from Pump's
 * FeeConfig: the first market-cap tier, or the flat fees if there are no tiers. Layout: 8
 * discriminator, bump, admin, flat Fees (3 x u64), vec<FeeTier { u128 threshold, Fees }>.
 */
export function freshCurveFeeBps(data: Buffer): number | null {
  if (data.length < 8 + 1 + 32 + 24 + 4 || !data.subarray(0, 8).equals(FEE_CONFIG_DISCRIMINATOR)) return null;
  const sum = (o: number) => Number(data.readBigUInt64LE(o) + data.readBigUInt64LE(o + 8) + data.readBigUInt64LE(o + 16));
  const flatAt = 8 + 1 + 32;
  const tiersAt = flatAt + 24;
  const n = data.readUInt32LE(tiersAt);
  if (n === 0) return sum(flatAt);
  if (data.length < tiersAt + 4 + 16 + 24) return null;
  return sum(tiersAt + 4 + 16);
}

export const pumpGlobalAddress = () => pda([Buffer.from("global")], PUMP).toBase58();
export const pumpFeeConfigAddress = () => pda([Buffer.from("fee_config"), PUMP], FEES).toBase58();

// ── Fallback: separate transactions (used only if the atomic launch cannot be used) ────────────
//
// Step 1 create_v2 alone. Step 2 the existing fee-sharing setup (fee-sharing-setup.ts, built from
// the live curve; adds sweep_creator_fee if trading happened). Step 3 the dev buy, priced from the
// live curve. Trades between step 1 and step 2 pay their creator fee to the launch wallet's own
// creator vault, NOT the treasury: the fallback cannot guarantee fee routing from the first trade.

/** Step 1: create_v2 only (signers: launch wallet + mint). */
export function buildCreateOnlyInstructions(p: CoinMetadataArgs & { mint: string; creator: string; priorityMicroLamports?: number }): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ...(p.priorityMicroLamports ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.priorityMicroLamports })] : []),
    buildCreateV2Instruction({ ...p, user: p.creator }),
  ];
}

/** Step 3: the dev buy alone (signer: launch wallet). */
export function buildDevBuyOnlyInstructions(p: { mint: string; creator: string; priorityMicroLamports?: number } & DevBuy): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ...(p.priorityMicroLamports ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.priorityMicroLamports })] : []),
    ...buildDevBuyInstructions({ mint: p.mint, user: p.creator, lamports: p.lamports, minTokensOut: p.minTokensOut, buybackFeeRecipient: p.buybackFeeRecipient }),
  ];
}

/** Bonding curve reserves (virtual_token_reserves @8, virtual_quote_reserves @16). */
export function decodeCurveReserves(data: Buffer): { virtualTokenReserves: bigint; virtualQuoteReserves: bigint } | null {
  if (data.length < 24) return null;
  return { virtualTokenReserves: data.readBigUInt64LE(8), virtualQuoteReserves: data.readBigUInt64LE(16) };
}

/** Tokens a buy of `lamports` (fees included) gets at the curve's CURRENT reserves. */
export function tokensOutAtReserves(lamports: bigint, r: { virtualTokenReserves: bigint; virtualQuoteReserves: bigint }, totalFeeBps: number): bigint {
  const net = (lamports * 10_000n) / (10_000n + BigInt(totalFeeBps));
  return (net * r.virtualTokenReserves) / (r.virtualQuoteReserves + net);
}

export function compileInstructions(payer: string, blockhash: string, instructions: TransactionInstruction[], lookupTables: AddressLookupTableAccount[] = []): VersionedTransaction {
  return new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables));
}

export const bondingCurveAddress = (mint: string) => pda([Buffer.from("bonding-curve"), new PublicKey(mint)], PUMP).toBase58();
