import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True for a syntactically valid Solana public key (32 bytes, base58). */
export function isValidPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || !BASE58.test(value)) return false;
  try {
    const pk = new PublicKey(value);
    // Round-trip guards against non-canonical encodings.
    return pk.toBase58() === value;
  } catch {
    return false;
  }
}

export const publicKeySchema = z
  .string()
  .trim()
  .refine(isValidPublicKey, { message: "Not a valid Solana public key" });

/** Well-known program / mint addresses. Not user-configurable. */
export const PROGRAMS = {
  TOKEN: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  TOKEN_2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  /** Pump.fun bonding-curve program (pump-fun/pump-public-docs). */
  PUMP: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  WRAPPED_SOL: "So11111111111111111111111111111111111111112",
} as const;
