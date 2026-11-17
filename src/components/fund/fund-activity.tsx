"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Coins, ExternalLink, Flame, Inbox, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client/client";
import { shortAddress } from "@/lib/format";
import { formatFundDate, formatSol, formatTokenAmount } from "@/lib/fund-format";
import type { FundEventDto, FundEventType, FundHistoryDto } from "@/contracts/demolition-fund";

const PAGE = 20;

const KIND: Record<FundEventType, { label: string; icon: LucideIcon; className: string }> = {
  FEE_RECEIPT: { label: "Fee received", icon: Coins, className: "bg-[#e9ecef] text-[#495057]" },
  BUYBACK: { label: "Buyback", icon: RefreshCw, className: "bg-d8-teal/15 text-d8-teal" },
  BURN: { label: "Burn", icon: Flame, className: "bg-d8-green text-white" },
  DISBURSEMENT: { label: "Paid out", icon: ArrowUpRight, className: "bg-[#e9ecef] text-[#495057]" },
};

interface FundActivityProps {
  initial: FundHistoryDto;
  ticker: string;
  decimals: number | null;
}

/** Fee receipts, buybacks, burns and payouts, newest first, each linked to Solscan. */
export function FundActivity({ initial, ticker, decimals }: FundActivityProps) {
  const [items, setItems] = useState<FundEventDto[]>(initial.items);
  const [next, setNext] = useState(initial.nextBefore);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function loadMore() {
    if (!next) return;
    setState("loading");
    try {
      const page = await api.getFundHistory({ limit: PAGE, before: next });
      setItems((prev) => [...prev, ...page.items]);
      setNext(page.nextBefore);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const token = (raw: string) => `${formatTokenAmount(raw, decimals)} $${ticker}`;

  return (
    <section aria-labelledby="fund-activity" className="min-w-0 rounded-md border border-[#ced4da] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <header className="border-b border-[#dee2e6] px-4 py-3">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#868e96] uppercase">On-chain</p>
        <h2 id="fund-activity" className="font-display text-2xl leading-tight font-bold text-[#212529]">
          Fund <span className="text-d8-green">activity</span>
        </h2>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Inbox className="size-8 text-[#adb5bd]" />
          <p className="font-semibold text-[#495057]">No fund activity yet</p>
          <p className="max-w-xs text-xs text-[#6c757d]">
            Fee receipts, buybacks and burns appear here as soon as they are verified on-chain.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-[#f1f3f5]">
          {items.map((e, i) => {
            const kind = KIND[e.type];
            const Icon = kind.icon;
            return (
              // One transaction can hold fee receipts for several properties, so the signature alone is not unique.
              <li key={`${i}:${e.type}:${e.signature}`} className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", kind.className)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-[#212529]">{kind.label}</p>
                    <p className="shrink-0 text-sm font-semibold text-[#212529] tabular-nums">
                      {e.type === "BURN" ? token(e.amount) : formatSol(e.amount)}
                    </p>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-[#6c757d]">
                    <span className="min-w-0 truncate">
                      {e.type === "FEE_RECEIPT" && e.property ? (
                        <>
                          from{" "}
                          <Link href={`/property/${e.property.slug}`} className="font-semibold text-d8-green hover:underline">
                            {e.property.name}
                          </Link>
                        </>
                      ) : e.type === "BUYBACK" && e.dynastyRaw ? (
                        <>bought {token(e.dynastyRaw)}</>
                      ) : e.type === "BURN" ? (
                        <>removed from supply</>
                      ) : e.type === "DISBURSEMENT" ? (
                        <>to the ecosystem or operations wallet</>
                      ) : null}
                    </span>
                    <a
                      href={e.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 font-semibold text-d8-green hover:underline"
                      aria-label={`${kind.label} transaction ${e.signature} on Solscan`}
                    >
                      {shortAddress(e.signature)} <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#868e96]">{formatFundDate(e.at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {next && (
        <div className="border-t border-[#dee2e6] p-3 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={state === "loading"}
            className="rounded-[3px] border-[1.5px] border-[#ced4da] px-4 py-1.5 text-sm font-bold text-[#212529] hover:bg-[#e9ecef] disabled:opacity-60"
          >
            {state === "loading" ? "Loading…" : "Load more"}
          </button>
          {state === "error" && <p className="mt-2 text-xs text-destructive">Could not load more activity. Try again.</p>}
        </div>
      )}
    </section>
  );
}
