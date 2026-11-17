import type { Metadata } from "next";
import { getEcosystemToken, getProperties } from "@/lib/data";
import { formatNumber, formatPrice, formatUsdCompact } from "@/lib/utils";
import { MarketsTable } from "@/components/markets/markets-table";
import { PriceChart } from "@/components/property/price-chart";
import { ContractAddress } from "@/components/property/contract-address";
import { DemoTag } from "@/components/ui/badge";
import { Change } from "@/components/ui/change";

export const metadata: Metadata = { title: "Markets" };

export default async function MarketsPage() {
  const [properties, realty] = await Promise.all([getProperties(), getEcosystemToken()]);
  const totalMcap = properties.reduce((s, p) => s + p.market.marketCapUsd, 0);
  const totalVol = properties.reduce((s, p) => s + p.market.volume24hUsd, 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-8 px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.3em] text-sunset">Markets</p>
          <h1 className="font-display text-4xl tracking-wide text-violet">Property token markets</h1>
          <p className="mt-1 max-w-2xl text-sm text-violet/70">
            One native ecosystem token and an independent Pump.fun-style token for every listing. Every figure below is
            simulated for this prototype.
          </p>
        </div>
        <DemoTag label="Demo data · not live" />
      </header>

      {/* Native token */}
      <section id="realty" className="scroll-mt-28 overflow-hidden rounded-[2rem] bg-midnight text-cream">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="bg-sunset grid h-14 w-14 place-items-center rounded-full font-display text-lg text-white">RLT</span>
              <div>
                <p className="font-display text-3xl leading-none tracking-wide">${realty.market.ticker}</p>
                <p className="text-sm text-cream/70">{realty.identity.name} · native ecosystem token</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-cream/75">
              REALTY is planned as the ecosystem token that ties the marketplace together. Property tokens remain
              separate assets with their own markets; REALTY does not represent them or any real estate.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3">
              {[
                ["Price", formatPrice(realty.market.priceUsd)],
                ["Market cap", formatUsdCompact(realty.market.marketCapUsd)],
                ["24h volume", formatUsdCompact(realty.market.volume24hUsd)],
                ["Holders", formatNumber(realty.market.holders)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-white/8 p-3">
                  <dt className="text-[10px] font-bold uppercase tracking-wider text-cream/55">{k}</dt>
                  <dd className="text-lg font-extrabold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 flex items-center gap-2 text-xs text-cream/60">
              24h <Change value={realty.market.change24hPct} className="text-xs" /> ·
              <span className="font-bold uppercase tracking-wider text-tangerine">Demo data</span>
            </p>
            <div className="mt-4 text-violet">
              <ContractAddress token={realty.identity} />
            </div>
          </div>
          <div className="rounded-3xl bg-cream p-4 text-violet">
            <PriceChart market={realty.market} />
          </div>
        </div>
      </section>

      {/* Totals */}
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Listed properties", String(properties.length)],
          ["Combined property mcap", formatUsdCompact(totalMcap)],
          ["Combined 24h volume", formatUsdCompact(totalVol)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-3xl bg-white p-5 ring-1 ring-violet/8">
            <p className="text-[11px] font-bold uppercase tracking-wider text-violet/55">{k}</p>
            <p className="font-display text-3xl tracking-wide text-violet">{v}</p>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#9a4a10]">Demo</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 font-display text-2xl tracking-wide text-violet">All property tokens</h2>
        <MarketsTable properties={properties} />
      </section>
    </div>
  );
}
