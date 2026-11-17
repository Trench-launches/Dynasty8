import "server-only";
import { Connection, PublicKey } from "@solana/web3.js";
import { getConfig } from "@/server/config";
import { providerBudgets } from "@/server/http/rate-limit";
import { ProviderError } from "@/server/http/fetch-json";
import { PROGRAMS } from "./address";

/**
 * Read-only Solana access. No keypairs, no signing, no transactions: this module only
 * ever calls getAccountInfo / getParsedAccountInfo.
 */
export interface MintInfo {
  exists: boolean;
  /** "TOKEN" | "TOKEN_2022" when the account is an SPL mint. */
  program: "TOKEN" | "TOKEN_2022" | null;
  supply: string | null;
  decimals: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface PumpCurveInfo {
  /** A bonding-curve account owned by the Pump program exists for this mint. */
  exists: boolean;
  /** Curve finished (real_token_reserves hit zero); the token migrates to PumpSwap. */
  complete: boolean | null;
}

export interface SolanaReader {
  getMintInfo(mint: string): Promise<MintInfo>;
  getPumpCurve(mint: string): Promise<PumpCurveInfo>;
}

/** Bonding curve layout: 8-byte discriminator, 5 x u64 reserves/supply, then `complete: bool`. */
export const PUMP_CURVE_COMPLETE_OFFSET = 8 + 5 * 8;

export function derivePumpCurveAddress(mint: string): string {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
    new PublicKey(PROGRAMS.PUMP),
  );
  return pda.toBase58();
}

export function decodePumpCurveComplete(data: Uint8Array): boolean | null {
  if (data.length <= PUMP_CURVE_COMPLETE_OFFSET) return null;
  const b = data[PUMP_CURVE_COMPLETE_OFFSET];
  return b === 1 ? true : b === 0 ? false : null;
}

function budget() {
  if (!providerBudgets.solanaRpc.take("rpc")) {
    throw new ProviderError("Solana RPC budget exhausted", "rate_limited");
  }
}

export function createSolanaReader(rpcUrl = getConfig().SOLANA_RPC_URL): SolanaReader {
  const conn = new Connection(rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true });

  return {
    async getMintInfo(mint) {
      budget();
      const res = await conn.getParsedAccountInfo(new PublicKey(mint));
      const acc = res.value;
      if (!acc) return { exists: false, program: null, supply: null, decimals: null, mintAuthority: null, freezeAuthority: null };
      const owner = acc.owner.toBase58();
      const program = owner === PROGRAMS.TOKEN ? "TOKEN" : owner === PROGRAMS.TOKEN_2022 ? "TOKEN_2022" : null;
      const data = acc.data as { parsed?: { type?: string; info?: Record<string, unknown> } } | Buffer;
      const parsed = !Buffer.isBuffer(data) ? data.parsed : undefined;
      if (!program || parsed?.type !== "mint" || !parsed.info) {
        return { exists: true, program: null, supply: null, decimals: null, mintAuthority: null, freezeAuthority: null };
      }
      const info = parsed.info;
      const supply = typeof info.supply === "string" && /^\d+$/.test(info.supply) ? info.supply : null;
      const decimals = typeof info.decimals === "number" && Number.isInteger(info.decimals) ? info.decimals : null;
      return {
        exists: true,
        program,
        supply,
        decimals,
        mintAuthority: typeof info.mintAuthority === "string" ? info.mintAuthority : null,
        freezeAuthority: typeof info.freezeAuthority === "string" ? info.freezeAuthority : null,
      };
    },

    async getPumpCurve(mint) {
      budget();
      const pda = derivePumpCurveAddress(mint);
      const acc = await conn.getAccountInfo(new PublicKey(pda));
      if (!acc || acc.owner.toBase58() !== PROGRAMS.PUMP) return { exists: false, complete: null };
      return { exists: true, complete: decodePumpCurveComplete(acc.data) };
    },
  };
}
