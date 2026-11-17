import { ExternalLink } from "lucide-react";
import { formatCount, shortAddress } from "@/lib/format";
import { formatFundDate, formatSol, formatTokenAmount } from "@/lib/fund-format";
import type { FundSummaryDto } from "@/contracts/demolition-fund";

const solscan = (signature: string) => `https://solscan.io/tx/${signature}`;

/** Verified fund totals plus the most recent buyback and burn. */
export function FundStats({ summary }: { summary: FundSummaryDto }) {
  const { totals: t, dynasty } = summary;
  const ticker = `$${dynasty.ticker}`;
  const amount = (raw: string) => `${formatTokenAmount(raw, dynasty.decimals)} ${ticker}`;

  return (
    <section aria-label="Fund totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Waiting to buy back" value={formatSol(t.pendingBuybackLamports)} note="Verified buyback share not yet spent" />
      <StatCard
        label="Spent on buybacks"
        value={formatSol(t.solSpentOnBuybacksLamports)}
        note={`${formatCount(t.successfulBuybacks)} buyback${t.successfulBuybacks === 1 ? "" : "s"}`}
      />
      <StatCard label={`${ticker} bought`} value={amount(t.dynastyPurchasedRaw)} note="On the open market" />
      <StatCard
        label="Fee receipts"
        value={formatCount(t.feeReceipts)}
        note={`From ${formatCount(t.contributingProperties)} propert${t.contributingProperties === 1 ? "y" : "ies"}`}
      />

      <LatestCard
        label="Latest buyback"
        empty="No buybacks yet"
        signature={summary.latestBuyback?.signature}
        at={summary.latestBuyback?.confirmedAt}
        detail={
          summary.latestBuyback &&
          `${formatSol(summary.latestBuyback.solSpentLamports)} → ${amount(summary.latestBuyback.dynastyReceivedRaw)}`
        }
      />
      <LatestCard
        label="Latest burn"
        empty="No burns yet"
        signature={summary.latestBurn?.signature}
        at={summary.latestBurn?.burnedAt}
        detail={summary.latestBurn && `${amount(summary.latestBurn.dynastyBurnedRaw)} burned`}
      />
    </section>
  );
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[#ced4da] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <p className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[22px] leading-tight font-semibold text-[#212529] tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-xs text-[#6c757d]">{note}</p>
    </div>
  );
}

function LatestCard({
  label,
  empty,
  signature,
  at,
  detail,
}: {
  label: string;
  empty: string;
  signature: string | undefined;
  at: string | undefined;
  detail: string | null | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#ced4da] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)] xl:col-span-2">
      <div className="min-w-0">
        <p className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</p>
        {signature && detail ? (
          <>
            <p className="mt-0.5 truncate text-base font-semibold text-[#212529] tabular-nums">{detail}</p>
            <p className="truncate text-xs text-[#6c757d]">{formatFundDate(at ?? null)}</p>
          </>
        ) : (
          <p className="mt-0.5 text-base font-semibold text-[#868e96]">{empty}</p>
        )}
      </div>
      {signature && (
        <a
          href={solscan(signature)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${label.toLowerCase()} on Solscan`}
          className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-[#ced4da] px-2.5 py-1 text-xs font-semibold text-d8-green hover:border-d8-green"
        >
          {shortAddress(signature)} <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}
