import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import type { ChainTx } from "./chain";

/**
 * Pump.fun creator-fee sharing, read-only.
 *
 * Adapted from HyperHouse (meridian/lib/solana/pump.ts: PUMP ids, pumpPda.sharingConfig /
 * creatorVault, decodeDistributeEvent), which follows Pump's published IDLs and
 * docs/instructions/CREATOR_FEE_SHARING.md in github.com/pump-fun/pump-public-docs.
 *
 * Model: each property coin has a fee-sharing config (PDA ["sharing-config", mint] under the
 * Pump Fees program) whose shareholders include the Demolition Fund wallet. Its creator vault
 * is per coin (["creator-vault", sharing_config]), and every payout emits a
 * DistributeCreatorFeesEvent naming the mint, so revenue is attributable per property.
 */
export const PUMP_PROGRAMS = {
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  fees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
} as const;

/** Anchor emit_cpi tag, then DistributeCreatorFeesEvent's discriminator. */
const EVENT_IX_TAG = Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
const DISTRIBUTE_EVENT = Buffer.from([165, 55, 129, 112, 4, 179, 202, 40]);

export function sharingConfigAddress(mint: string): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sharing-config"), new PublicKey(mint).toBuffer()],
    new PublicKey(PUMP_PROGRAMS.fees),
  )[0].toBase58();
}

export function creatorVaultAddress(sharingConfig: string): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("creator-vault"), new PublicKey(sharingConfig).toBuffer()],
    new PublicKey(PUMP_PROGRAMS.pump),
  )[0].toBase58();
}

export interface DistributeEvent {
  mint: string;
  sharingConfig: string;
  shareholders: { address: string; shareBps: number }[];
  distributed: bigint;
}

class Reader {
  o = 0;
  constructor(private b: Buffer) {}
  need(n: number) {
    if (this.o + n > this.b.length) throw new RangeError("event truncated");
  }
  pk() {
    this.need(32);
    const v = new PublicKey(this.b.subarray(this.o, this.o + 32)).toBase58();
    this.o += 32;
    return v;
  }
  u16() {
    this.need(2);
    const v = this.b.readUInt16LE(this.o);
    this.o += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.b.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  i64() {
    this.need(8);
    const v = this.b.readBigInt64LE(this.o);
    this.o += 8;
    return v;
  }
}

/** Decodes one emit_cpi instruction's data, or null if it is not a DistributeCreatorFeesEvent. */
export function decodeDistributeEvent(data: Buffer): DistributeEvent | null {
  if (data.length < 16 || !data.subarray(0, 8).equals(EVENT_IX_TAG) || !data.subarray(8, 16).equals(DISTRIBUTE_EVENT)) return null;
  try {
    const x = new Reader(data.subarray(16));
    x.i64(); // timestamp
    const mint = x.pk();
    x.pk(); // bonding_curve
    const sharingConfig = x.pk();
    x.pk(); // admin
    const n = x.u32();
    if (n > 10) return null; // Pump allows at most 10 shareholders
    const shareholders = Array.from({ length: n }, () => ({ address: x.pk(), shareBps: x.u16() }));
    const distributed = x.u64();
    return { mint, sharingConfig, shareholders, distributed };
  } catch {
    return null;
  }
}

/** Encoder used by tests to build fixture events with the exact on-chain layout. */
export function encodeDistributeEvent(e: DistributeEvent, timestamp = 0n): Buffer {
  const parts: Buffer[] = [EVENT_IX_TAG, DISTRIBUTE_EVENT];
  const i64 = Buffer.alloc(8);
  i64.writeBigInt64LE(timestamp);
  parts.push(i64, new PublicKey(e.mint).toBuffer(), new PublicKey(PUMP_PROGRAMS.pump).toBuffer(), new PublicKey(e.sharingConfig).toBuffer(), new PublicKey(PUMP_PROGRAMS.fees).toBuffer());
  const n = Buffer.alloc(4);
  n.writeUInt32LE(e.shareholders.length);
  parts.push(n);
  for (const s of e.shareholders) {
    const bps = Buffer.alloc(2);
    bps.writeUInt16LE(s.shareBps);
    parts.push(new PublicKey(s.address).toBuffer(), bps);
  }
  const d = Buffer.alloc(8);
  d.writeBigUInt64LE(e.distributed);
  parts.push(d);
  return Buffer.concat(parts);
}

/**
 * Distribute events emitted by the genuine Pump program in a successful transaction.
 * Only inner instructions addressed to the Pump program id count: Anchor's emit_cpi
 * requires Pump's own event-authority PDA to sign, so other programs cannot forge them
 * without the transaction failing (and failed transactions are rejected here).
 */
export function distributeEventsIn(tx: ChainTx): DistributeEvent[] {
  if (tx.err) return [];
  const out: DistributeEvent[] = [];
  for (const ix of tx.instructions) {
    if (!ix.inner || ix.programId !== PUMP_PROGRAMS.pump || !ix.data) continue;
    let raw: Buffer;
    try {
      raw = Buffer.from(bs58.decode(ix.data));
    } catch {
      continue;
    }
    const e = decodeDistributeEvent(raw);
    if (e) out.push(e);
  }
  return out;
}
