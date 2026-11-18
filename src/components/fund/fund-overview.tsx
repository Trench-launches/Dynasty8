import { ExternalLink, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/format";
import { formatBps, formatFundDate, formatSol } from "@/lib/fund-format";
import type { FundSummaryDto } from "@/contracts/demolition-fund";

type FundState = { label: string; note: string; className: string; dot: string };

function fundState(s: FundSummaryDto): FundState {
  const ticker = `$${s.dynasty.ticker}`;
  if (!s.dynasty.live) {
    return {
      label: "Not started",
      note: `Buybacks begin once ${ticker} is live and the fund has received creator fees.`,
      className: "border-[#ced4da] bg-[#f8f9fa] text-d8-ink",
      dot: "bg-[#adb5bd]",
    };
  }
  if (s.status.circuitOpen) {
    return {
      label: "Safety stop",
      note: "A safety check stopped buybacks until an admin reviews it. Fee receipts are still being verified.",
      className: "border-destructive/40 bg-destructive/10 text-destructive",
      dot: "bg-destructive",
    };
  }
  if (s.status.paused) {
    return {
      label: "Buybacks paused",
      note: "Buybacks are paused by an admin. Fee receipts are still being verified.",
      className: "border-amber-400/60 bg-amber-50 text-amber-800",
      dot: "bg-amber-500",
    };
  }
  return {
    label: "Active",
    note: `Verified creator fees are buying back and burning ${ticker}.`,
    className: "border-d8-green bg-d8-green text-white",
    dot: "bg-white",
  };
}

const SHARES = [
  { key: "buybackBps", total: "buybackAllocatedLamports", label: "Buyback & burn", swatch: "bg-d8-green" },
  { key: "ecosystemBps", total: "ecosystemAllocatedLamports", label: "Ecosystem", swatch: "bg-d8-teal" },
  { key: "operationsBps", total: "operationsAllocatedLamports", label: "Operations", swatch: "bg-[#adb5bd]" },
] as const;

/** What the fund does, whether it is running, and how each fee is split. */
export function FundOverview({ summary }: { summary: FundSummaryDto }) {
  const state = fundState(summary);
  const ticker = `$${summary.dynasty.ticker}`;

  return (
    <section
      aria-label="How the fund works"
      className="grid gap-x-8 gap-y-5 border-2 border-d8-green bg-d8-mint-soft p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 items-start gap-4">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-d8-green text-white sm:size-16">
          <Flame className="size-7 sm:size-8" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[17px] tracking-[0.04em] text-d8-green uppercase">Buyback &amp; burn</p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wider whitespace-nowrap uppercase",
                state.className,
              )}
            >
              <span className={cn("size-1.5 rounded-full", state.dot)} />
              {state.label}
            </span>
          </div>
          <p className="mt-1 text-[26px] leading-tight font-bold text-d8-ink sm:text-[30px]">
            Property tax that burns <span className="text-d8-green">{ticker}</span>
          </p>
          <ol className="mt-2 space-y-1 text-[15px] leading-relaxed text-[#444]">
            {summary.treasury.allocationMode === "ON_CHAIN_SPLIT" ? (
              <>
                <li>
                  <b className="text-d8-ink">1.</b> Every property token shares its Pump.fun creator fees on-chain.
                </li>
                <li>
                  <b className="text-d8-ink">2.</b> Pump.fun pays each fee straight to three wallets:{" "}
                  {formatBps(summary.allocation.buybackBps)} to the buyback fund, {formatBps(summary.allocation.ecosystemBps)} to the
                  ecosystem, {formatBps(summary.allocation.operationsBps)} to operations.
                </li>
              </>
            ) : (
              <>
                <li>
                  <b className="text-d8-ink">1.</b> Every property token pays Pump.fun creator fees into the fund wallet.
                </li>
                <li>
                  <b className="text-d8-ink">2.</b> Each fee is split: {formatBps(summary.allocation.buybackBps)} to buybacks,{" "}
                  {formatBps(summary.allocation.ecosystemBps)} to the ecosystem, {formatBps(summary.allocation.operationsBps)} to
                  operations.
                </li>
              </>
            )}
            <li>
              <b className="text-d8-ink">3.</b> The buyback share buys {ticker} on the open market, and every token bought is
              burned. Each step is a multisig-approved transaction you can check on Solscan.
            </li>
          </ol>
          <p className="mt-2 text-[15px] font-medium text-d8-ink">{state.note}</p>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <p className="text-[10px] tracking-wider text-[#868e96] uppercase">Where each fee goes</p>
        <div className="flex h-3 overflow-hidden rounded-full bg-[#e9ecef]" role="img" aria-label="Fee split">
          {SHARES.map(({ key, swatch }) => (
            <span key={key} className={swatch} style={{ width: `${summary.allocation[key] / 100}%` }} />
          ))}
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {SHARES.map(({ key, total, label, swatch }) => (
            <div key={key} className="rounded-md bg-[#f8f9fa] px-2.5 py-2">
              <dt className="flex items-center gap-1.5 text-[10px] tracking-wider text-[#868e96] uppercase">
                <span className={cn("size-2 shrink-0 rounded-sm", swatch)} />
                <span className="truncate">{label}</span>
              </dt>
              <dd className="mt-0.5 text-lg leading-tight font-semibold text-[#212529] tabular-nums">
                {formatBps(summary.allocation[key])}
              </dd>
              <dd className="truncate text-[11px] text-[#6c757d] tabular-nums">{formatSol(summary.totals[total])}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#6c757d]">
          <span>
            Fund wallet:{" "}
            {summary.fundWallet ? (
              <a
                href={`https://solscan.io/account/${summary.fundWallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-d8-green hover:underline"
              >
                {shortAddress(summary.fundWallet)} <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="font-semibold text-d8-ink">not registered yet</span>
            )}
          </span>
          <span>
            Last ledger check:{" "}
            <span className="font-semibold text-d8-ink">
              {summary.status.lastReconciliation
                ? `${summary.status.lastReconciliation.ok ? "balanced" : "mismatch"}, ${formatFundDate(summary.status.lastReconciliation.at)}`
                : "none yet"}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
