import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Car, BedDouble, ExternalLink, MapPin, Ruler, Sparkles, Info } from "lucide-react";
import { getProperties, getProperty, getPropertySlugs } from "@/lib/data";
import { formatNumber, formatUsdCompact } from "@/lib/utils";
import { PropertyArt } from "@/components/property/property-art";
import { PriceChart } from "@/components/property/price-chart";
import { TokenStats } from "@/components/property/token-stats";
import { ContractAddress } from "@/components/property/contract-address";
import { TradeButton } from "@/components/property/trade-button";
import { TokenEmblem } from "@/components/property/token-emblem";
import { Badge, DemoTag } from "@/components/ui/badge";
import { Change } from "@/components/ui/change";

export function generateStaticParams() {
  return getPropertySlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProperty(slug);
  return p ? { title: `${p.name} ($${p.market.ticker})`, description: p.tagline } : { title: "Not found" };
}

export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProperty(slug);
  if (!p) notFound();
  const others = (await getProperties()).filter((o) => o.slug !== p.slug).slice(0, 3);

  const facts = [
    { icon: MapPin, label: "Neighbourhood", value: p.neighbourhood },
    { icon: Building2, label: "Classification", value: p.category },
    { icon: Ruler, label: "Floor area", value: `${formatNumber(p.floorAreaSqFt)} sq ft` },
    { icon: BedDouble, label: "Bedrooms", value: p.bedrooms ?? "Commercial" },
    { icon: Car, label: "Garage", value: `${p.garageSpaces} spaces` },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">
      <Link
        href={`/?property=${p.slug}`}
        className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-extrabold text-violet ring-1 ring-violet/12 hover:text-sunset hover:ring-sunset"
      >
        <ArrowLeft className="size-4" aria-hidden /> Back to Map
      </Link>

      {/* Hero */}
      <section className="relative mt-4 overflow-hidden rounded-[2rem] shadow-[0_30px_60px_-30px_rgba(48,32,79,0.7)]">
        <div className="h-[300px] sm:h-[420px]">
          <PropertyArt art={p.art} seed={p.slug} title={`${p.name} illustration`} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-midnight/85 via-midnight/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-8">
          <div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="sunset">{p.category}</Badge>
              <Badge className="bg-white/90">{p.neighbourhood}</Badge>
            </div>
            <h1 className="mt-2 font-display text-4xl leading-none tracking-wide text-cream sm:text-6xl">{p.name}</h1>
            <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-cream/80">
              <MapPin className="size-4" aria-hidden /> {p.location}, {p.neighbourhood}
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white/12 px-4 py-3 text-cream ring-1 ring-white/20 backdrop-blur-md">
            <TokenEmblem ticker={p.market.ticker} className="h-11 w-11" />
            <div>
              <p className="font-display text-2xl leading-none tracking-wide">${p.market.ticker}</p>
              <p className="mt-1 flex items-center gap-2 text-xs font-bold">
                {formatUsdCompact(p.market.marketCapUsd)} mcap
                <Change value={p.market.change24hPct} className="text-xs" />
              </p>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-tangerine">Demo data</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          {/* About */}
          <section className="rounded-3xl bg-white p-5 ring-1 ring-violet/8 sm:p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.3em] text-sunset">The listing</p>
            <h2 className="mt-1 font-display text-2xl tracking-wide text-violet">{p.tagline}</h2>
            <p className="mt-3 leading-relaxed text-violet/80">{p.description}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {p.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5 text-xs font-bold text-violet">
                  <Sparkles className="size-3.5 text-sunset" aria-hidden /> {f}
                </li>
              ))}
            </ul>
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-2xl bg-cream/70 p-3">
                  <dt className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet/55">
                    <Icon className="size-3.5" aria-hidden /> {label}
                  </dt>
                  <dd className="mt-1 text-sm font-extrabold text-violet">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-violet/5 p-3 text-xs text-violet/70">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              The building and its details are fictional. ${p.market.ticker} is an independent token; holding it does
              not grant ownership of this or any building, rental income, or in-game property rights.
            </p>
          </section>

          {/* Market overview */}
          <section className="rounded-3xl bg-white p-5 ring-1 ring-violet/8 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.3em] text-sunset">Market overview</p>
                <h2 className="font-display text-2xl tracking-wide text-violet">${p.market.ticker} price</h2>
              </div>
              <DemoTag label="Demo chart · not live" />
            </div>
            <PriceChart market={p.market} />
          </section>
        </div>

        {/* Token sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-3xl bg-white p-5 ring-1 ring-violet/8">
            <div className="flex items-center gap-3">
              <TokenEmblem ticker={p.market.ticker} className="h-12 w-12" />
              <div>
                <p className="font-display text-2xl leading-none tracking-wide text-violet">${p.market.ticker}</p>
                <p className="text-xs font-semibold text-violet/60">{p.token.name} · Pump.fun-style token</p>
              </div>
            </div>
            <div className="mt-4">
              <TokenStats market={p.market} />
            </div>
            <div className="mt-4 space-y-3">
              <ContractAddress token={p.token} />
              <div className="flex items-center justify-between rounded-xl bg-white p-3 ring-1 ring-violet/8">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-violet/55">Pump.fun market</p>
                  <p className="text-xs font-semibold text-violet/70">Link appears once the token launches</p>
                </div>
                <span
                  aria-disabled
                  className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg px-2 py-1 text-xs font-extrabold text-violet/35 ring-1 ring-violet/10"
                >
                  Open <ExternalLink className="size-3.5" aria-hidden />
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-cream/70 p-2.5">
                  <dt className="font-bold uppercase tracking-wider text-violet/55 text-[10px]">Total supply</dt>
                  <dd className="font-extrabold text-violet">{formatNumber(p.token.totalSupply)}</dd>
                </div>
                <div className="rounded-xl bg-cream/70 p-2.5">
                  <dt className="font-bold uppercase tracking-wider text-violet/55 text-[10px]">Decimals</dt>
                  <dd className="font-extrabold text-violet">{p.token.decimals}</dd>
                </div>
              </dl>
              <TradeButton ticker={p.market.ticker} />
            </div>
          </section>
        </aside>
      </div>

      {/* More listings */}
      <section className="mt-10">
        <h2 className="font-display text-2xl tracking-wide text-violet">More on the market</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {others.map((o) => (
            <Link
              key={o.slug}
              href={`/property/${o.slug}`}
              className="group overflow-hidden rounded-3xl bg-white ring-1 ring-violet/8 transition-shadow hover:shadow-lg"
            >
              <div className="h-36 overflow-hidden">
                <div className="h-full transition-transform duration-500 group-hover:scale-105">
                  <PropertyArt art={o.art} seed={o.slug} title={`${o.name} illustration`} />
                </div>
              </div>
              <div className="flex items-center justify-between p-4">
                <div>
                  <p className="font-display text-lg tracking-wide text-violet">{o.name}</p>
                  <p className="text-xs font-semibold text-violet/55">{o.neighbourhood}</p>
                </div>
                <span className="rounded-full bg-midnight px-2 py-0.5 text-[11px] font-extrabold text-cream">
                  ${o.market.ticker}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
