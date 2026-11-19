import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { MarketsGrid } from "@/components/markets/markets-grid";
import { PageTitle, SummaryStat } from "@/components/ui/panel";
import { getCatalogue, getEcosystemMarkets, getEcosystemToken } from "@/lib/catalogue";
import { formatUsdCompact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Markets",
  description: "Every DYNASTY property token in one place.",
};

export default function MarketsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MarketsContent />
    </Suspense>
  );
}

async function MarketsContent() {
  const [properties, ecosystem, summary] = await Promise.all([
    getCatalogue(),
    getEcosystemToken(),
    getEcosystemMarkets(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader ecosystem={ecosystem} />
      <main className="w-full flex-1 space-y-8 px-3 py-6 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageTitle title="Property markets">
            Every listed property token on one board. Figures only appear for tokens that are live and verified.
          </PageTitle>
          <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto">
            <SummaryStat label="Live tokens" value={`${summary.liveTokens} / ${summary.totalListings}`} />
            <SummaryStat label="Market cap" value={formatUsdCompact(summary.totalMarketCapUsd)} />
            <SummaryStat label="24h volume" value={formatUsdCompact(summary.totalVolume24hUsd)} />
          </dl>
        </div>

        {summary.source === "demo" && (
          <p className="border border-neon/30 bg-neon/10 px-4 py-2 text-xs text-neon">
            Demo mode: market figures on this page are generated for design preview and are not real.
          </p>
        )}

        <MarketsGrid properties={properties} />
      </main>
      <SiteFooter />
    </div>
  );
}
