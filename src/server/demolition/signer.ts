import "server-only";
import type { VersionedTransaction } from "@solana/web3.js";

/**
 * The signing boundary. The API, the worker and the frontend never hold key material.
 *
 * Production plan (docs/DEMOLITION-FUND.md): the FUND wallet is a multisig vault
 * (e.g. Squads). Buybacks and burns are proposed to the multisig; members approve and
 * execute; the backend then verifies the finalized transaction by signature. Unattended
 * execution needs a managed signer (KMS / signing gateway enforcing policy.ts) and
 * explicit owner approval. Until then only the disabled signer exists, so nothing can sign.
 */
export interface TransactionSigner {
  readonly publicKey: string;
  readonly kind: "disabled" | "kms" | "test";
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

export class SigningDisabledError extends Error {
  constructor() {
    super("Automated signing is disabled. Use the multisig proposal flow.");
    this.name = "SigningDisabledError";
  }
}

export const disabledSigner: TransactionSigner = {
  publicKey: "",
  kind: "disabled",
  async signTransaction() {
    throw new SigningDisabledError();
  },
};
