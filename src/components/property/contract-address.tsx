"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { TokenIdentity } from "@/lib/integrations/types";

/** Shows the mint address, or a clear placeholder while the token does not exist. */
export function ContractAddress({ token }: { token: TokenIdentity }) {
  const [copied, setCopied] = useState(false);
  const address = token.mintAddress;
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-violet/8">
      <p className="text-[10px] font-bold uppercase tracking-wider text-violet/55">Contract address (mint)</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-violet/5 px-2 py-1.5 font-mono text-xs text-violet/70">
          {address ?? "Not deployed yet · placeholder"}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!address}
          title={address ? "Copy address" : "No address to copy until the token launches"}
          aria-label="Copy contract address"
          className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-violet ring-1 ring-violet/15 hover:bg-violet/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}
