import "server-only";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountMeta,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { getConfig } from "@/server/config";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { recordAudit, type Actor } from "@/server/services/audit";
import { expectedShareholdersFor } from "./fee-sharing";
import { decodeSharingConfig, PUMP_PROGRAMS, sharingConfigAddress, type SharingConfig } from "./pump-fees";
import { MAX_TX_BYTES } from "./squads";

/**
 * Post-launch Pump fee-sharing setup for a Dynasty 8 coin: one transaction, signed by the coin's
 * creator in their own wallet, that
 *   1. create_fee_sharing_config  (creator -> sharing-config PDA; initial shares [creator 10000])
 *   2. update_fee_shares_v2       (final shares = the registered treasury vaults; admin revoked)
 * The shareholders are never taken from the request: they are the treasury wallets registered
 * in the database (expectedShareholders), so this cannot route fees anywhere else. The backend
 * builds and SIMULATES the transaction; it never signs or sends it.
 * Layouts: github.com/pump-fun/pump-public-docs (idl/pump_fees.json, CREATOR_FEE_SHARING.md),
 * checked against mainnet by scripts/verify/simulate-fee-shares.ts.
 */
const FEES = new PublicKey(PUMP_PROGRAMS.fees);
const PUMP = new PublicKey(PUMP_PROGRAMS.pump);
const AMM = new PublicKey(PUMP_PROGRAMS.amm);
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = new PublicKey("11111111111111111111111111111111");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
export const CREATE_FEE_SHARING_CONFIG = Buffer.from([195, 78, 86, 76, 111, 52, 251, 213]);
export const UPDATE_FEE_SHARES_V2 = Buffer.from([111, 251, 49, 6, 78, 78, 106, 18]);
/** Pump sweep_creator_fee: moves a waiting creator fee into [creator-vault, creator]. Permissionless. */
export const SWEEP_CREATOR_FEE = Buffer.from([32, 246, 191, 52, 8, 201, 73, 186]);

const pda = (seeds: (Buffer | PublicKey)[], program: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds.map((s) => (s instanceof PublicKey ? s.toBuffer() : s)), program)[0];
const ata = (owner: PublicKey, mint: PublicKey) => pda([owner, TOKEN, mint], ATA_PROGRAM);
const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });

export type Holder = { address: string; shareBps: number };

export interface BondingCurveInfo {
  complete: boolean;
  creator: string;
  /** Null on older curve layouts (SOL-paired). */
  quoteMint: string | null;
  isHolderReward: boolean;
  /** Creator fee waiting to be swept (new trade instructions); 0 on older layouts. */
  pendingCreatorFee: bigint;
}

/**
 * Pump BondingCurve (idl/pump.json): 8 discriminator, 5 x u64, complete bool @48, creator @49,
 * is_mayhem_mode @81, is_cashback_coin @82, quote_mint @83, creator_fee_bps u64 @115,
 * can_edit_creator_fee @123, is_holder_reward @124, creator_fee u64 @125. Older accounts end
 * earlier; missing fields read as defaults.
 */
export function decodeBondingCurve(data: Buffer): BondingCurveInfo | null {
  if (data.length < 81) return null;
  const qm = data.length >= 115 ? new PublicKey(data.subarray(83, 115)).toBase58() : null;
  return {
    complete: data[48] === 1,
    creator: new PublicKey(data.subarray(49, 81)).toBase58(),
    quoteMint: qm === PublicKey.default.toBase58() ? null : qm,
    isHolderReward: data.length >= 125 ? data[124] === 1 : false,
    pendingCreatorFee: data.length >= 133 ? data.readBigUInt64LE(125) : 0n,
  };
}

export function encodeUpdateShares(holders: Holder[]): Buffer {
  const b = Buffer.alloc(12 + holders.length * 34);
  UPDATE_FEE_SHARES_V2.copy(b, 0);
  b.writeUInt32LE(holders.length, 8);
  holders.forEach((h, i) => {
    new PublicKey(h.address).toBuffer().copy(b, 12 + i * 34);
    b.writeUInt16LE(h.shareBps, 44 + i * 34);
  });
  return b;
}

/** Pure instruction builder. `existing` is the decoded sharing config, if one already exists. */
export function buildFeeSharingInstructions(p: { mint: string; creator: string; holders: Holder[]; existing: SharingConfig | null; sweep?: boolean }): TransactionInstruction[] {
  const mint = new PublicKey(p.mint);
  const creator = new PublicKey(p.creator);
  const sharingConfig = new PublicKey(sharingConfigAddress(p.mint));
  const bondingCurve = pda([Buffer.from("bonding-curve"), mint], PUMP);
  const feesEvent = pda([Buffer.from("__event_authority")], FEES);
  const pumpEvent = pda([Buffer.from("__event_authority")], PUMP);
  const global = pda([Buffer.from("global")], PUMP);
  const ixs: TransactionInstruction[] = [];
  if (p.sweep) {
    // Pump refuses to change the creator while a creator fee is waiting (CreatorFeesNotSwept).
    // The sweep pays it to the CURRENT creator's vault, where that creator can still claim it.
    const curveCreator = p.existing ? sharingConfig : creator;
    const recipient = pda([Buffer.from("creator-vault"), curveCreator], PUMP);
    ixs.push(
      new TransactionInstruction({
        programId: PUMP,
        data: SWEEP_CREATOR_FEE,
        keys: [
          { pubkey: creator, isSigner: true, isWritable: true },
          ro(global),
          ro(mint),
          ro(WSOL),
          ro(TOKEN),
          ro(ATA_PROGRAM),
          ro(SYSTEM),
          rw(bondingCurve),
          rw(ata(bondingCurve, WSOL)),
          rw(recipient),
          rw(ata(recipient, WSOL)),
          ro(pumpEvent),
          ro(PUMP),
        ],
      }),
    );
  }
  if (!p.existing) {
    ixs.push(
      new TransactionInstruction({
        programId: FEES,
        data: CREATE_FEE_SHARING_CONFIG,
        keys: [
          ro(feesEvent),
          ro(FEES),
          { pubkey: creator, isSigner: true, isWritable: true },
          ro(global),
          ro(mint),
          rw(sharingConfig),
          ro(SYSTEM),
          rw(bondingCurve),
          ro(PUMP),
          ro(pumpEvent),
          // Optional AMM accounts (graduated coins only): Anchor's "None" is the program's own id.
          ro(FEES),
          ro(FEES),
          ro(FEES),
        ],
      }),
    );
  }
  const current = p.existing ? p.existing.shareholders.map((s) => s.address) : [p.creator];
  const creatorVault = pda([Buffer.from("creator-vault"), sharingConfig], PUMP);
  const ammVaultAuth = pda([Buffer.from("creator_vault"), sharingConfig], AMM);
  ixs.push(
    new TransactionInstruction({
      programId: FEES,
      data: encodeUpdateShares(p.holders),
      keys: [
        ro(feesEvent),
        ro(FEES),
        { pubkey: creator, isSigner: true, isWritable: true },
        ro(global),
        ro(mint),
        rw(sharingConfig),
        ro(bondingCurve),
        rw(creatorVault),
        rw(ata(creatorVault, WSOL)),
        ro(SYSTEM),
        ro(PUMP),
        ro(pumpEvent),
        ro(AMM),
        ro(pda([Buffer.from("__event_authority")], AMM)),
        ro(WSOL),
        ro(TOKEN),
        ro(ATA_PROGRAM),
        rw(ammVaultAuth),
        rw(ata(ammVaultAuth, WSOL)),
        // Remaining accounts: the CURRENT shareholders, paid any pending fees first.
        ...current.map((a) => rw(new PublicKey(a))),
      ],
    }),
  );
  return ixs;
}

export interface PumpSetupRpc {
  getAccount(address: string): Promise<{ owner: string; data: Buffer } | null>;
  getLatestBlockhash(): Promise<string>;
  getSlot(): Promise<number>;
  getBalance(address: string): Promise<number>;
  simulate(tx: VersionedTransaction): Promise<{ err: unknown; logs: string[]; unitsConsumed?: number }>;
  /** Active address lookup table, or null. */
  getLookupTable(address: string): Promise<AddressLookupTableAccount | null>;
}

function rpcFromConfig(): PumpSetupRpc {
  const conn = new Connection(getConfig().SOLANA_RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true });
  return {
    async getAccount(a) {
      const i = await conn.getAccountInfo(new PublicKey(a));
      return i ? { owner: i.owner.toBase58(), data: Buffer.from(i.data) } : null;
    },
    async getLatestBlockhash() {
      return (await conn.getLatestBlockhash()).blockhash;
    },
    async getSlot() {
      return conn.getSlot("finalized");
    },
    async getBalance(a) {
      return conn.getBalance(new PublicKey(a));
    },
    async simulate(tx) {
      const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
      return { err: r.value.err, logs: r.value.logs ?? [], unitsConsumed: r.value.unitsConsumed };
    },
    async getLookupTable(a) {
      const r = await conn.getAddressLookupTable(new PublicKey(a));
      return r.value && r.value.isActive() ? r.value : null;
    },
  };
}

let rpcOverride: PumpSetupRpc | null = null;
export function getPumpSetupRpc(): PumpSetupRpc {
  return rpcOverride ?? rpcFromConfig();
}
export function setPumpSetupRpcForTests(r: PumpSetupRpc | null) {
  rpcOverride = r;
}

export interface FeeSharingSetup {
  mint: string;
  token: { ticker: string; kind: "PROPERTY" | "NATIVE" };
  creator: string;
  sharingConfig: string;
  shareholders: Holder[];
  steps: ("sweep_creator_fee" | "create_fee_sharing_config" | "update_fee_shares_v2")[];
  /** Unsigned v0 transaction; fee payer and only signer = the coin creator. */
  transactionBase64: string;
  transactionBytes: number;
  simulation: { ok: boolean; error: string | null; logs: string[] };
  warnings: string[];
}

/**
 * Prepares the fee-sharing transaction for a REGISTERED Dynasty 8 mint. Refuses: unregistered
 * mints, a creator that is not the coin's creator / sharing-config admin, a locked config,
 * graduated coins (set those up through Pump directly), missing treasury wallets, and any
 * transaction whose simulation fails (the caller gets the error, not a transaction to sign).
 */
export async function prepareFeeSharingSetup(mint: string, creator: string, actor: Actor): Promise<FeeSharingSetup> {
  const rpc = getPumpSetupRpc();
  const token = await prisma.token.findUnique({ where: { mintAddress: mint }, select: { id: true, ticker: true, isNative: true } });
  if (!token) throw new ApiError(422, "UNPROCESSABLE", "Register this mint to its property (or as the DYNASTY token) first");
  // Property coins: 60/25/15. $DYNASTY itself: 100% FUND (Option C).
  const expected = await expectedShareholdersFor(token.isNative ? "NATIVE" : "PROPERTY");
  if (!expected) throw new ApiError(422, "UNPROCESSABLE", "Register the FUND, ECOSYSTEM and OPERATIONS treasury wallets first");

  let bcAcct, scAcct;
  try {
    [bcAcct, scAcct] = await Promise.all([
      rpc.getAccount(pda([Buffer.from("bonding-curve"), new PublicKey(mint)], PUMP).toBase58()),
      rpc.getAccount(sharingConfigAddress(mint)),
    ]);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Pump accounts from Solana; try again later");
  }
  if (!bcAcct || bcAcct.owner !== PUMP_PROGRAMS.pump) throw new ApiError(422, "UNPROCESSABLE", "No Pump bonding curve exists for this mint");
  const bc = decodeBondingCurve(bcAcct.data);
  if (!bc) throw new ApiError(422, "UNPROCESSABLE", "Unrecognised bonding curve account");
  if (bc.complete) throw new ApiError(422, "UNPROCESSABLE", "This coin has graduated; set up its fee sharing with Pump's own tools");
  if (bc.isHolderReward) throw new ApiError(422, "UNPROCESSABLE", "Holder-rewards coins cannot use creator fee sharing");
  if (bc.quoteMint && bc.quoteMint !== WSOL.toBase58()) throw new ApiError(422, "UNPROCESSABLE", "Only SOL-paired coins are supported");

  let existing: SharingConfig | null = null;
  if (scAcct) {
    existing = scAcct.owner === PUMP_PROGRAMS.fees ? decodeSharingConfig(scAcct.data) : null;
    if (!existing) throw new ApiError(422, "UNPROCESSABLE", "Unrecognised sharing config account");
    if (existing.adminRevoked) throw new ApiError(409, "CONFLICT", "Fee sharing is already locked for this coin; it can no longer be changed");
    if (existing.admin !== creator) throw new ApiError(403, "FORBIDDEN", "Only the sharing config admin can set the shares");
  } else if (bc.creator !== creator) {
    throw new ApiError(403, "FORBIDDEN", "Only the coin's creator wallet can set up fee sharing");
  }

  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...buildFeeSharingInstructions({ mint, creator, holders: expected.holders, existing, sweep: bc.pendingCreatorFee > 0n })];
  let tx: VersionedTransaction;
  let sim;
  try {
    const msg = new TransactionMessage({ payerKey: new PublicKey(creator), recentBlockhash: await rpc.getLatestBlockhash(), instructions: ixs }).compileToV0Message();
    tx = new VersionedTransaction(msg);
    sim = await rpc.simulate(tx);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not simulate the transaction on Solana; try again later");
  }
  const bytes = tx.serialize();
  if (bytes.length > MAX_TX_BYTES) throw new ApiError(422, "UNPROCESSABLE", `Transaction is ${bytes.length} bytes (max ${MAX_TX_BYTES})`);
  const ok = sim.err === null || sim.err === undefined;
  const warnings: string[] = [];
  await recordAudit(prisma, actor, "fee_sharing.setup_prepared", "Token", token.id, null, { mint, creator, holders: expected.holders, simulationOk: ok });
  if (!ok) {
    throw new ApiError(422, "UNPROCESSABLE", `Simulation failed: ${JSON.stringify(sim.err)} ${sim.logs.filter((l) => /Error|failed/.test(l)).slice(-2).join(" | ")}`.slice(0, 500));
  }
  return {
    mint,
    token: { ticker: token.ticker, kind: token.isNative ? "NATIVE" : "PROPERTY" },
    creator,
    sharingConfig: sharingConfigAddress(mint),
    shareholders: expected.holders,
    steps: [
      ...(bc.pendingCreatorFee > 0n ? (["sweep_creator_fee"] as const) : []),
      ...(existing ? [] : (["create_fee_sharing_config"] as const)),
      "update_fee_shares_v2" as const,
    ],
    transactionBase64: Buffer.from(bytes).toString("base64"),
    transactionBytes: bytes.length,
    simulation: { ok, error: null, logs: sim.logs.slice(-8) },
    warnings,
  };
}
