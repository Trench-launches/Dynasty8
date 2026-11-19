import Link from "next/link";
import { Home, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/data/regions";
import { formatUsdCompact, locationLabel, tickerLabel } from "@/lib/format";
import { PropertyArt } from "@/components/property/property-art";
import { ChangeText, MarketDataTag } from "@/components/property/badges";
import { BigFigure, pillButton } from "@/components/ui/panel";
import type { Property, TokenStatus } from "@/lib/types";

const STATUS: Record<TokenStatus, string> = {
  live: "Live",
  coming_soon: "Coming soon",
  unavailable: "Paused",
};

/**
 * Property token card in the style of an estate-agent listing: photo with a yellow category band,
 * the address line, a pale green price strip with a BUY pill, then the area.
 * BUY only links out for a verified, live token with a Pump.fun page; otherwise VIEW opens the listing.
 */
export function PropertyMarketCard({ property }: { property: Property }) {
  const { token, market: m } = property;
  const href = `/property/${property.slug}`;
  const buyUrl = token.status === "live" && token.mintVerified ? token.pumpFunUrl : null;
  const area = locationLabel(property);
  const category = CATEGORY_LABELS[property.category];

  return (
    <article className="group flex flex-col border border-vc-line bg-vc-surface p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow hover:shadow-[0_4px_14px_rgba(0,0,0,0.1)]">
      <Link
        href={href}
        className="relative block overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={-1}
        aria-hidden
      >
        <PropertyArt
          property={property}
          sizes="(max-width: 640px) 100vw, 360px"
          className="aspect-[16/10] w-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <span className="absolute top-2 right-2 bg-black/65 px-2 py-1 text-[13px] leading-none font-bold text-white">
          {tickerLabel(property)}
        </span>
        {property.featured && (
          <span className="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-vc-surface/95 text-vc-accent shadow-sm">
            <Star className="size-4 fill-current" aria-label="Featured" />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-vc-primary/95 py-1.5 text-center text-[22px] leading-tight font-bold tracking-[0.02em] text-white uppercase text-shadow-[0_1px_2px_rgb(0_0_0/0.35)]">
          {category}
        </span>
      </Link>

      <div className="flex items-center justify-between gap-3 px-1 pt-2.5 pb-2 text-[16px]">
        <Link href={href} className="min-w-0 truncate text-vc-text outline-none hover:underline focus-visible:underline">
          {property.name}
        </Link>
        <span className="flex shrink-0 items-center gap-1.5 text-vc-text-2">
          {STATUS[token.status]} <Home className="size-4 fill-current" aria-hidden />
        </span>
      </div>

      <div className="flex min-h-[58px] items-center justify-between gap-3 bg-vc-surface-3 py-2 pr-2 pl-3">
        <div className="min-w-0">
          {m?.marketCapUsd != null ? (
            <BigFigure value={formatUsdCompact(m.marketCapUsd)} unit="MCAP" size="sm" />
          ) : (
            <p className="truncate text-[22px] leading-tight text-vc-muted">
              {token.status === "unavailable" ? "Trading paused" : "Price pending"}
            </p>
          )}
          {token.status === "coming_soon" && (
            <p className="mt-0.5 text-[13px] tracking-[0.06em] text-vc-accent uppercase">Launching soon</p>
          )}
        </div>
        {buyUrl ? (
          <a
            href={buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Buy ${tickerLabel(property)} on Pump.fun`}
            className={pillButton}
          >
            Buy
          </a>
        ) : (
          <Link href={href} aria-label={`View ${property.name}`} className={pillButton}>
            View
          </Link>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-1 pt-2.5 text-[15px]">
        <span className="min-w-0 truncate text-vc-text">{area || category}</span>
        {m ? (
          <span className={cn("flex shrink-0 items-center gap-1.5 text-[13px] text-vc-text-2 tabular-nums")}>
            24h <ChangeText value={m.change24hPct} />
            <MarketDataTag market={m} />
          </span>
        ) : (
          <span className="shrink-0 text-[13px] text-vc-text-2">Trades on Pump.fun</span>
        )}
      </div>
    </article>
  );
}
