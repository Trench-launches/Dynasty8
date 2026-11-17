import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, MapPinOff } from "lucide-react";
import { CATEGORY_LABELS, REGION_BY_ID } from "@/data/regions";
import { getCatalogue, getCatalogueProperty, getEcosystemToken } from "@/lib/catalogue";
import { locationLabel, tickerLabel } from "@/lib/format";
import { SiteHeader } from "@/components/layout/site-header";
import { PropertyArt } from "@/components/property/property-art";
import { FeaturedBadge, TokenStatusBadge, VerificationBadge } from "@/components/property/badges";
import { MarketPanel } from "@/components/property/market-panel";

export async function generateStaticParams() {
  const properties = await getCatalogue();
  return properties.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/property/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const property = await getCatalogueProperty(slug);
  if (!property) return { title: "Listing not found" };
  return {
    title: `${property.name} (${tickerLabel(property)})`,
    description: property.description,
  };
}

export default async function PropertyPage({ params }: PageProps<"/property/[slug]">) {
  const { slug } = await params;
  const [property, ecosystem] = await Promise.all([getCatalogueProperty(slug), getEcosystemToken()]);
  if (!property) notFound();

  const region = REGION_BY_ID[property.region];

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader ecosystem={ecosystem} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href={`/?p=${property.slug}`}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold text-white/80 hover:bg-white/[0.07] hover:text-white"
        >
          <ArrowLeft className="size-4" /> Back to map
        </Link>

        <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10">
          <PropertyArt property={property} className="aspect-[16/7] w-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
            <div className="flex flex-wrap gap-2">
              <TokenStatusBadge status={property.token.status} className="bg-black/60 backdrop-blur" />
              {property.featured && <FeaturedBadge className="bg-black/60 backdrop-blur" />}
            </div>
            <p className="mt-3 text-xs font-bold tracking-[0.22em] text-sunset uppercase">{CATEGORY_LABELS[property.category]}</p>
            <h1 className="font-display text-5xl leading-[0.9] tracking-wide text-white sm:text-7xl">{property.name}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-white/70">
              <MapPin className="size-4" /> {locationLabel(property)}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.25fr]">
          <section className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-card p-5">
              <h2 className="font-display text-2xl tracking-wide text-white">ABOUT THIS PROPERTY</h2>
              <p className="mt-2 leading-relaxed text-white/70">{property.description}</p>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <Detail label="Region" value={region?.name ?? "—"} />
                <Detail label="Neighbourhood" value={property.neighbourhood} />
                <Detail label="Type" value={CATEGORY_LABELS[property.category]} />
                <Detail label="Ticker" value={tickerLabel(property)} />
              </dl>
              <div className="mt-5 space-y-1.5 border-t border-white/10 pt-4">
                {property.location ? (
                  <p className="flex items-center gap-1.5 text-xs text-white/55">
                    <MapPin className="size-3.5" />
                    {property.location.precision === "exact" ? "Exact map placement" : "Approximate district placement on the map"}
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-white/55">
                    <MapPinOff className="size-3.5" /> Map placement pending
                  </p>
                )}
                <VerificationBadge property={property} />
                {property.verification.note && <p className="text-xs text-white/40">{property.verification.note}</p>}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-xs leading-relaxed text-white/45">
              <p className="font-bold tracking-[0.18em] text-white/60 uppercase">Important</p>
              <p className="mt-2">
                {tickerLabel(property)} is a themed digital collectible traded on Pump.fun. Holding it does not grant ownership of,
                or any rights to, any real or in-game property. Token prices are volatile and you can lose everything you put in.
                Dynasty 8 is a fan-made project and is not affiliated with Rockstar Games or Take-Two Interactive.
              </p>
            </div>
          </section>

          <MarketPanel property={property} />
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/40 px-3 py-2.5">
      <dt className="text-[10px] tracking-wider text-white/45 uppercase">{label}</dt>
      <dd className="mt-0.5 font-semibold text-white">{value}</dd>
    </div>
  );
}
