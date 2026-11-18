import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, MapPinOff } from "lucide-react";
import { CATALOGUE, slugify } from "@/data/catalogue";
import { getCatalogueProperty, getEcosystemToken } from "@/lib/catalogue";
import { locationLabel, tickerLabel } from "@/lib/format";
import { PageLoading } from "@/components/layout/page-loading";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { PropertyArt } from "@/components/property/property-art";
import { FeaturedBadge, TokenStatusBadge, VerificationBadge } from "@/components/property/badges";
import { PropertyMarket } from "@/components/property/market-panel";
import { SectionHeading } from "@/components/ui/panel";

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

      <main className="w-full flex-1 px-3 py-6 sm:px-6 sm:py-8">
        <Link
          href={`/?p=${property.slug}`}
          className="inline-flex items-center gap-1.5 text-[15px] tracking-[0.04em] text-d8-green uppercase outline-none hover:underline focus-visible:underline"
        >
          <ArrowLeft className="size-4" /> Back to map
        </Link>

        <div className="mt-4 overflow-hidden border border-[#e3e3e3] bg-white p-2 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <PropertyArt
            full
            property={property}
            className="aspect-[3/2] w-full sm:aspect-[21/9] lg:aspect-auto lg:h-[min(56vh,560px)]"
            sizes="100vw"
            preload
          />
        </div>

        {/* Description | spec table | buy panel. Two columns on laptops (specs under the description), one on phones. */}
        <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-1">
            <header>
              <div className="mb-3 flex flex-wrap gap-2">
                <TokenStatusBadge status={property.token.status} />
                {property.featured && <FeaturedBadge />}
              </div>
              <h1 className="text-[40px] leading-[1.1] font-bold text-d8-ink sm:text-[48px]">{property.name}</h1>
              <p className="mt-2 text-[19px] text-[#444]">{locationLabel(property)}</p>
            </header>

            <p className="text-[19px] leading-[1.8] text-[#444]">{property.description}</p>

            <section aria-labelledby="where-fees-go" className="space-y-3">
              <SectionHeading id="where-fees-go">Where the fees go</SectionHeading>
              <p className="text-[18px] leading-[1.75] text-[#444]">
                Every {tickerLabel(property)} trade pays a Pump.fun creator fee. Those fees go to the{" "}
                <Link href="/fund" className="text-d8-green underline-offset-2 hover:underline">
                  Demolition Fund
                </Link>
                , which buys back and burns ${ecosystem.ticker}. Only finalized, verified on-chain transactions count.
              </p>
            </section>

            <section aria-labelledby="on-the-map" className="space-y-3">
              <SectionHeading id="on-the-map">On the map</SectionHeading>
              <div className="space-y-1.5">
                {property.location ? (
                  <p className="flex items-center gap-1.5 text-[16px] text-[#555]">
                    <MapPin className="size-4" />
                    {property.location.precision === "exact" ? "Exact map placement" : "Approximate district placement on the map"}
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-[16px] text-[#555]">
                    <MapPinOff className="size-4" /> Map placement pending
                  </p>
                )}
                <VerificationBadge property={property} />
                {property.verification.note && <p className="text-sm text-[#777]">{property.verification.note}</p>}
              </div>
            </section>
          </div>

          <PropertyMarket
            property={property}
            specsClassName="min-w-0 lg:col-start-1 lg:row-start-2 xl:col-start-2 xl:row-start-1"
            panelClassName="min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start xl:col-start-3"
            chartClassName="lg:col-start-1 lg:row-start-3 xl:col-span-2 xl:row-start-2"
          />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
