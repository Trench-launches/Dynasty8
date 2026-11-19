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
      className: "border-vc-line-strong bg-vc-surface-2 text-vc-text",
      dot: "bg-vc-line-strong",
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
      className: "border-vc-cream/50 bg-vc-cream/10 text-vc-cream",
      dot: "bg-vc-cream",
    };
  }
  return {
    label: "Active",
    note: `Verified creator fees are buying back and burning ${ticker}.`,
    className: "border-vc-violet bg-vc-primary text-white",
    dot: "bg-vc-surface",
  };
}

const SHARES = [
  { key: "buybackBps", total: "buybackAllocatedLamports", label: "Buyback & burn", swatch: "bg-vc-primary" },
  { key: "ecosystemBps", total: "ecosystemAllocatedLamports", label: "Ecosystem", swatch: "bg-vc-violet" },
  { key: "operationsBps", total: "operationsAllocatedLamports", label: "Operations", swatch: "bg-vc-line-strong" },
] as const;

/** What the fund does, whether it is running, and how each fee is split. */
export function FundOverview({ summary }: { summary: FundSummaryDto }) {
  const state = fundState(summary);
  const ticker = `$${summary.dynasty.ticker}`;

  return (
    <section
      aria-label="How the fund works"
      className="grid gap-x-8 gap-y-5 border-2 border-vc-violet bg-vc-surface-2 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 items-start gap-4">
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-vc-primary text-white sm:size-16">
          <Flame className="size-7 sm:size-8" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[17px] tracking-[0.04em] text-vc-accent uppercase">Buyback &amp; burn</p>
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
          <p className="mt-1 text-[26px] leading-tight font-bold text-vc-text sm:text-[30px]">
            Property tax that burns <span className="text-vc-accent">{ticker}</span>
          </p>
          <ol className="mt-2 space-y-1 text-[15px] leading-relaxed text-vc-text-2">
            {summary.treasury.allocationMode === "ON_CHAIN_SPLIT" ? (
              <>
                <li>
                  <b className="text-vc-text">1.</b> Every property token shares its Pump.fun creator fees on-chain.
                </li>
                <li>
                  <b className="text-vc-text">2.</b> Pump.fun pays each fee straight to three wallets:{" "}
                  {formatBps(summary.allocation.buybackBps)} to the buyback fund, {formatBps(summary.allocation.ecosystemBps)} to the
                  ecosystem, {formatBps(summary.allocation.operationsBps)} to operations.
                </li>
              </>
            ) : (
              <>
                <li>
                  <b className="text-vc-text">1.</b> Every property token pays Pump.fun creator fees into the fund wallet.
                </li>
                <li>
                  <b className="text-vc-text">2.</b> Each fee is split: {formatBps(summary.allocation.buybackBps)} to buybacks,{" "}
                  {formatBps(summary.allocation.ecosystemBps)} to the ecosystem, {formatBps(summary.allocation.operationsBps)} to
                  operations.
                </li>
              </>
            )}
            <li>
              <b className="text-vc-text">3.</b> The buyback share buys {ticker} on the open market, and every token bought is
              burned. Each step is a multisig-approved transaction you can check on Solscan.
            </li>
          </ol>
          <p className="mt-2 text-[15px] font-medium text-vc-text">{state.note}</p>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <p className="text-[10px] tracking-wider text-vc-faint uppercase">Where each fee goes</p>
        <div className="flex h-3 overflow-hidden rounded-full bg-vc-surface-3" role="img" aria-label="Fee split">
          {SHARES.map(({ key, swatch }) => (
            <span key={key} className={swatch} style={{ width: `${summary.allocation[key] / 100}%` }} />
          ))}
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {SHARES.map(({ key, total, label, swatch }) => (
            <div key={key} className="rounded-md bg-vc-surface-2 px-2.5 py-2">
              <dt className="flex items-center gap-1.5 text-[10px] tracking-wider text-vc-faint uppercase">
                <span className={cn("size-2 shrink-0 rounded-sm", swatch)} />
                <span className="truncate">{label}</span>
              </dt>
              <dd className="mt-0.5 text-lg leading-tight font-semibold text-vc-text tabular-nums">
                {formatBps(summary.allocation[key])}
              </dd>
              <dd className="truncate text-[11px] text-vc-muted tabular-nums">{formatSol(summary.totals[total])}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-vc-muted">
          <span>
            Fund wallet:{" "}
            {summary.fundWallet ? (
              <a
                href={`https://solscan.io/account/${summary.fundWallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-vc-accent hover:underline"
              >
                {shortAddress(summary.fundWallet)} <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className="font-semibold text-vc-text">not registered yet</span>
            )}
          </span>
          <span>
            Last ledger check:{" "}
            <span className="font-semibold text-vc-text">
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
