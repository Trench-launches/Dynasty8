import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, MapPinOff } from "lucide-react";
import { CATEGORY_LABELS, regionName } from "@/data/regions";
import { CATALOGUE, slugify } from "@/data/catalogue";
import { getCatalogueProperty, getEcosystemToken } from "@/lib/catalogue";
import { locationLabel, tickerLabel } from "@/lib/format";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PropertyArt } from "@/components/property/property-art";
import { FeaturedBadge, TokenStatusBadge, VerificationBadge } from "@/components/property/badges";
import { MarketPanel } from "@/components/property/market-panel";

/**
 * Shells for the launch catalogue are built ahead of time from the static catalogue, so the
 * build never needs a database. Listings added later by admins render on demand.
 */
export function generateStaticParams() {
  return CATALOGUE.map((e) => ({ slug: slugify(e.name) }));
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

export default function PropertyPage({ params }: PageProps<"/property/[slug]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PropertyContent params={params} />
    </Suspense>
  );
}

async function PropertyContent({ params }: Pick<PageProps<"/property/[slug]">, "params">) {
  const { slug } = await params;
  const [property, ecosystem] = await Promise.all([getCatalogueProperty(slug), getEcosystemToken()]);
  if (!property) notFound();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader ecosystem={ecosystem} />

      {/* Same horizontal padding as the header, so content lines up with the logo and wallet button. */}
      <main className="w-full flex-1 px-3 py-6 sm:px-6 sm:py-8">
        <Link
          href={`/?p=${property.slug}`}
          className="inline-flex items-center gap-2 rounded border-[1.5px] border-[#ced4da] px-4 py-2 text-sm font-bold text-[#212529] hover:bg-[#e9ecef] hover:text-[#212529]"
        >
          <ArrowLeft className="size-4" /> Back to map
        </Link>

        <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:items-start xl:gap-8">
          {/* Photo on the left. On desktop it pins to the viewport and fills its full height while the
              details scroll; on phones it sits on top at its natural 3:2 shape. */}
          <div className="overflow-hidden rounded-2xl border border-[#dee2e6] lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
            <PropertyArt
              property={property}
              className="aspect-[3/2] w-full lg:aspect-auto lg:h-full"
              sizes="(max-width: 1024px) 100vw, 50vw"
              preload
            />
          </div>

          {/* Details on the right. */}
          <div className="space-y-6">
            <header>
              <div className="flex flex-wrap gap-2">
                <TokenStatusBadge status={property.token.status} />
                {property.featured && <FeaturedBadge />}
              </div>
              <p className="mt-3 text-sm font-semibold tracking-[0.08em] text-mint uppercase">{CATEGORY_LABELS[property.category]}</p>
              <h1 className="font-display text-4xl leading-tight text-cream sm:text-5xl">{property.name}</h1>
              <p className="mt-2 flex items-center gap-1.5 text-[#495057]">
                <MapPin className="size-4" /> {locationLabel(property)}
              </p>
            </header>

            <section className="rounded-2xl border border-[#dee2e6] bg-card p-5">
              <h2 className="font-display text-2xl text-cream">About this property</h2>
              <p className="mt-2 leading-relaxed text-[#495057]">{property.description}</p>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <Detail label="Region" value={regionName(property.region) ?? "—"} />
                <Detail label="Neighbourhood" value={property.neighbourhood} />
                <Detail label="Type" value={CATEGORY_LABELS[property.category]} />
                <Detail label="Ticker" value={tickerLabel(property)} />
              </dl>
              <div className="mt-5 space-y-1.5 border-t border-[#dee2e6] pt-4">
                {property.location ? (
                  <p className="flex items-center gap-1.5 text-xs text-[#6c757d]">
                    <MapPin className="size-3.5" />
                    {property.location.precision === "exact" ? "Exact map placement" : "Approximate district placement on the map"}
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-[#6c757d]">
                    <MapPinOff className="size-3.5" /> Map placement pending
                  </p>
                )}
                <VerificationBadge property={property} />
                {property.verification.note && <p className="text-xs text-[#868e96]">{property.verification.note}</p>}
              </div>
            </section>

            <MarketPanel property={property} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f8f9fa] px-3 py-2.5">
      <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</dt>
      <dd className="mt-0.5 font-semibold text-[#212529]">{value}</dd>
    </div>
  );
}
