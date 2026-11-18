import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FundActivity } from "@/components/fund/fund-activity";
import { FundLeaderboard } from "@/components/fund/fund-leaderboard";
import { FundOverview } from "@/components/fund/fund-overview";
import { FundStats } from "@/components/fund/fund-stats";
import { FundBurnChart } from "@/components/fund/fund-burn-chart";
import { FundBuybacks } from "@/components/fund/fund-buybacks";
import { FundTreasury } from "@/components/fund/fund-treasury";
import { PageTitle, SummaryStat } from "@/components/ui/panel";
import { getCatalogue, getEcosystemToken } from "@/lib/catalogue";
import { getFundPage } from "@/lib/fund";
import { formatCount } from "@/lib/format";
import { formatSol, formatTokenCompact } from "@/lib/fund-format";

export const metadata: Metadata = {
  title: "Demolition Fund",
  description: "Creator fees from every DYNASTY property token buy back and burn $DYNASTY. Every figure is verified on-chain.",
};

export default function FundPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <FundContent />
    </Suspense>
  );
}

async function FundContent() {
  const [{ summary, contributions, history, burns }, properties, ecosystem] = await Promise.all([
    getFundPage(),
    getCatalogue(),
    getEcosystemToken(),
  ]);
  const { totals: t, dynasty } = summary;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader ecosystem={ecosystem} />
      <main className="w-full flex-1 space-y-8 px-3 py-6 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageTitle title="Demolition fund">
            Every property token pays tax into one fund that buys back and burns ${dynasty.ticker}. Only finalized,
            verified on-chain transactions count here.
          </PageTitle>
          <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto">
            <SummaryStat label="Creator fees" value={formatSol(t.creatorFeesLamports, 2)} />
            <SummaryStat label={`$${dynasty.ticker} burned`} value={formatTokenCompact(t.dynastyBurnedRaw, dynasty.decimals)} />
            <SummaryStat label="Burns" value={formatCount(t.successfulBurns)} />
          </dl>
        </div>

        <FundOverview summary={summary} />
        <FundStats summary={summary} />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <FundBuybacks buybacks={summary.buybacks} pending={summary.pendingActions} ticker={dynasty.ticker} decimals={dynasty.decimals} />
          <FundBurnChart burns={burns} ticker={dynasty.ticker} decimals={dynasty.decimals} />
        </div>

        <FundTreasury summary={summary} />

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <FundLeaderboard
            contributions={contributions}
            properties={properties}
            ticker={dynasty.ticker}
            decimals={dynasty.decimals}
          />
          <FundActivity initial={history} ticker={dynasty.ticker} decimals={dynasty.decimals} />
        </div>

        <p className="text-[13px] leading-relaxed text-[#777]">
          Buybacks and burns reduce ${dynasty.ticker} supply; they do not guarantee any price or return. Figures refresh about
          every minute and include only finalized transactions the backend has verified. Property tokens are themed digital
          collectibles. Not affiliated with Rockstar Games or Take-Two Interactive. Nothing here is financial advice.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
