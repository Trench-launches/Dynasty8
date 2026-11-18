"use client";

import { VersionedTransaction } from "@solana/web3.js";

/**
 * Minimal Phantom provider access (window.phantom.solana). The app never sees a private key:
 * Phantom shows the transaction, the user approves it in Phantom, and Phantom signs and sends.
 */
interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: { toBase58(): string } | null;
  isConnected: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>;
  on(event: "accountChanged" | "disconnect", cb: (pk: { toBase58(): string } | null) => void): void;
  removeListener?(event: string, cb: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const p = window.phantom?.solana;
  return p?.isPhantom ? p : null;
}

/**
 * Asks Phantom to sign and send an unsigned v0 transaction prepared by the backend.
 * Refuses if the fee payer (first signer) is not the connected wallet, so a prepared
 * transaction can never ask the user to pay for or sign on behalf of someone else.
 */
export async function signAndSend(base64: string, expectedSigner: string): Promise<string> {
  const phantom = getPhantom();
  if (!phantom?.publicKey) throw new Error("Connect Phantom first");
  if (phantom.publicKey.toBase58() !== expectedSigner) throw new Error("The connected Phantom account changed; reconnect and try again");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map((k) => k.toBase58());
  if (signers.length !== 1 || signers[0] !== expectedSigner) throw new Error("This transaction needs a signer other than your wallet; it was not sent");
  const { signature } = await phantom.signAndSendTransaction(tx);
  return signature;
}
