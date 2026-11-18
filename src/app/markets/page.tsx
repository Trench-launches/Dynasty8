import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { MarketsGrid } from "@/components/markets/markets-grid";
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
      <main className="w-full flex-1 space-y-6 px-3 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl leading-none font-bold text-[#212529] sm:text-5xl">
              PROPERTY <span className="text-sunset-gradient">MARKETS</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[#6c757d]">
              Every listed property token on one board. Figures only appear for tokens that are live and verified.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-right">
            <Summary label="Live tokens" value={`${summary.liveTokens} / ${summary.totalListings}`} />
            <Summary label="Total market cap" value={formatUsdCompact(summary.totalMarketCapUsd)} />
            <Summary label="24h volume" value={formatUsdCompact(summary.totalVolume24hUsd)} />
          </dl>
        </div>

        {summary.source === "demo" && (
          <p className="rounded-lg border border-neon/30 bg-neon/10 px-4 py-2 text-xs text-neon">
            Demo mode: market figures on this page are generated for design preview and are not real.
          </p>
        )}

        <MarketsGrid properties={properties} />
      </main>
      <SiteFooter />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#dee2e6] bg-card px-3 py-2">
      <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</dt>
      <dd className="font-display text-2xl text-cream">{value}</dd>
    </div>
  );
}
