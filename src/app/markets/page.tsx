import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteHeader } from "@/components/layout/site-header";
import { LogoMark } from "@/components/brand/logo";
import { MarketsGrid } from "@/components/markets/markets-grid";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import { getCatalogue, getEcosystemMarkets, getEcosystemToken } from "@/lib/catalogue";
import { formatPrice, formatUsdCompact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Markets",
  description: "Every DYNASTY property token and the DYNASTY ecosystem token in one place.",
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
  const m = ecosystem.market;

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

        <section
          aria-label="Ecosystem token"
          className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-md border border-[#ced4da] border-l-4 border-l-d8-green bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)] sm:p-5"
        >
          <div className="flex min-w-0 flex-1 basis-[420px] items-center gap-4">
            <LogoMark className="size-14 sm:size-16" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-d8-green uppercase">Ecosystem token</p>
              <p className="font-display text-2xl leading-tight font-bold text-[#212529] sm:text-3xl">
                {ecosystem.name} <span className="text-d8-green">${ecosystem.ticker}</span>
              </p>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#6c757d]">{ecosystem.summary}</p>
            </div>
          </div>
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="sr-only">Status</dt>
              <dd>
                <TokenStatusBadge status={ecosystem.status} />
              </dd>
            </div>
            <TokenStat label="Price" value={<span className="flex items-center gap-1.5">{formatPrice(m?.priceUsd)}<MarketDataTag market={m} /></span>} />
            <TokenStat label="24h" value={<ChangeText value={m?.change24hPct} />} />
            <TokenStat label="Market cap" value={formatUsdCompact(m?.marketCapUsd)} />
          </dl>
        </section>

        <MarketsGrid properties={properties} />

        <p className="text-[11px] leading-relaxed text-[#868e96]">
          Property tokens are themed digital collectibles. Holding one does not grant ownership of any real or in-game
          property. Not affiliated with Rockstar Games or Take-Two Interactive. Nothing here is financial advice.
        </p>
      </main>
    </div>
  );
}

function TokenStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-right">
      <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</dt>
      <dd className="text-base font-semibold text-[#212529] tabular-nums">{value}</dd>
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
