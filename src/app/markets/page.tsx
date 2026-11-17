import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/site-header";
import { MarketsTable } from "@/components/markets/markets-table";
import { ChangeText, DemoTag, TokenStatusBadge } from "@/components/property/badges";
import { getCatalogue, getEcosystemMarkets, getEcosystemToken } from "@/lib/catalogue";
import { formatPrice, formatUsdCompact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Markets",
  description: "Every Dynasty 8 property token and the REALTY ecosystem token in one place.",
};

export default async function MarketsPage() {
  const [properties, ecosystem, summary] = await Promise.all([
    getCatalogue(),
    getEcosystemToken(),
    getEcosystemMarkets(),
  ]);
  const m = ecosystem.market;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader ecosystem={ecosystem} />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-5xl leading-none tracking-wide text-white sm:text-6xl">
              PROPERTY <span className="text-sunset-gradient">MARKETS</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/55">
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

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-r from-violet-deep/60 to-card p-5">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-white/45 uppercase">Ecosystem token</p>
            <p className="font-display text-3xl leading-none tracking-wide text-white">
              {ecosystem.name} <span className="text-sunset-gradient">${ecosystem.ticker}</span>
            </p>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-white/55">{ecosystem.summary}</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <TokenStatusBadge status={ecosystem.status} />
            <span className="text-white/80 tabular-nums">{formatPrice(m?.priceUsd)}</span>
            <ChangeText value={m?.change24hPct} />
            <DemoTag market={m} />
          </div>
        </section>

        <MarketsTable properties={properties} />

        <p className="text-[11px] leading-relaxed text-white/40">
          Property tokens are themed digital collectibles. Holding one does not grant ownership of any real or in-game
          property. Not affiliated with Rockstar Games or Take-Two Interactive. Nothing here is financial advice.
        </p>
      </main>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-card px-3 py-2">
      <dt className="text-[10px] tracking-wider text-white/45 uppercase">{label}</dt>
      <dd className="font-display text-xl tracking-wide text-white">{value}</dd>
    </div>
  );
}
