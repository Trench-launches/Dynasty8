import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { formatFundDate, formatSol, formatTokenAmount } from "@/lib/fund-format";
import { PropertyArt } from "@/components/property/property-art";
import type { PropertyContributionDto } from "@/contracts/demolition-fund";
import type { Property } from "@/lib/types";
import { PanelHeader } from "@/components/ui/panel";

interface FundLeaderboardProps {
  contributions: PropertyContributionDto[];
  /** Catalogue listings, for photos. */
  properties: Property[];
  ticker: string;
  decimals: number | null;
}

/** Properties ranked by the creator fees their token has paid into the fund. */
export function FundLeaderboard({ contributions, properties, ticker, decimals }: FundLeaderboardProps) {
  const bySlug = new Map(properties.map((p) => [p.slug, p]));
  const anyRanked = contributions.some((c) => c.rank !== null);

  return (
    <section aria-labelledby="fund-leaderboard" className="min-w-0 border border-vc-line bg-vc-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <PanelHeader id="fund-leaderboard" title="Top contributors" note="Leaderboard" className="-mx-px -mt-px" />
      {!anyRanked && (
        <p className="border-b border-vc-line px-4 py-3 text-[15px] text-vc-text-2">
          No contributions yet. Properties rank here once their creator fees reach the fund.
        </p>
      )}

      <div className="overflow-x-auto">
        {/* Fixed layout: number columns keep their widths and the property column takes the rest (names truncate). */}
        <table className="w-full table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-vc-line text-[10px] tracking-wider text-vc-faint uppercase">
              <th scope="col" className="w-11 py-2 pr-1 pl-4 font-semibold">#</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Property</th>
              <th scope="col" className="w-32 py-2 pr-4 text-right font-semibold sm:pr-3">Creator fees</th>
              <th scope="col" className="hidden w-24 py-2 pr-3 text-right font-semibold sm:table-cell">To buyback</th>
              <th scope="col" className="hidden w-32 truncate py-2 pr-4 text-right font-semibold sm:table-cell lg:pr-3">${ticker} burned</th>
              <th scope="col" className="hidden w-44 py-2 pr-4 text-right font-semibold lg:table-cell">Last fee</th>
            </tr>
          </thead>
          <tbody>
            {contributions.map((c) => {
              const property = bySlug.get(c.property.slug);
              const ranked = c.rank !== null;
              return (
                <tr key={c.property.slug} className="border-b border-vc-line last:border-0 hover:bg-vc-surface-2">
                  <td className="py-2 pr-1 pl-4">
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full text-xs font-bold tabular-nums",
                        c.rank === 1 ? "bg-vc-primary text-white" : ranked ? "bg-vc-surface-3 text-vc-text" : "text-vc-faint",
                      )}
                    >
                      {c.rank ?? "–"}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/property/${c.property.slug}`}
                      className="group flex min-w-0 items-center gap-3 outline-none focus-visible:underline"
                    >
                      {property && (
                        <PropertyArt property={property} sizes="48px" className="h-9 w-12 shrink-0 rounded-[3px] border border-vc-line" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-vc-text group-hover:underline">{c.property.name}</span>
                        {c.property.ticker && <span className="block text-xs font-bold text-vc-accent">${c.property.ticker}</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums sm:pr-3">
                    {ranked ? (
                      <>
                        <span className="font-semibold text-vc-text">{formatSol(c.creatorFeesLamports)}</span>
                        <span className="block text-[11px] text-vc-faint">
                          {formatCount(c.feeReceipts)} receipt{c.feeReceipts === 1 ? "" : "s"}
                        </span>
                        {/* Phones have no burned column; show it under the fees instead. */}
                        <span className="block text-[11px] font-semibold text-vc-accent sm:hidden">
                          {formatTokenAmount(c.dynastyBurnedRaw, decimals)} burned
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-vc-faint">No fees yet</span>
                    )}
                  </td>
                  <td className="hidden py-2 pr-3 text-right whitespace-nowrap text-vc-text-2 tabular-nums sm:table-cell">
                    {ranked ? formatSol(c.buybackAllocatedLamports) : <Muted />}
                  </td>
                  <td className="hidden py-2 pr-4 text-right whitespace-nowrap text-vc-text-2 tabular-nums sm:table-cell lg:pr-3">
                    {ranked ? formatTokenAmount(c.dynastyBurnedRaw, decimals) : <Muted />}
                  </td>
                  <td className="hidden py-2 pr-4 text-right text-xs whitespace-nowrap text-vc-muted lg:table-cell">
                    {ranked ? formatFundDate(c.lastReceiptAt) : <Muted />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Muted() {
  return <span className="text-vc-faint">—</span>;
}
