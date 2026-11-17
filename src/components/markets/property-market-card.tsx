import Link from "next/link";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/data/regions";
import { formatPrice, formatUsdCompact, locationLabel, tickerLabel } from "@/lib/format";
import { PropertyArt } from "@/components/property/property-art";
import { ChangeText, MarketDataTag } from "@/components/property/badges";
import type { Property, TokenStatus } from "@/lib/types";

const RIBBON: Record<TokenStatus, { label: string; className: string }> = {
  live: { label: "Live", className: "bg-d8-green text-white" },
  coming_soon: { label: "Soon", className: "bg-d8-green text-white" },
  unavailable: { label: "Paused", className: "bg-[#adb5bd] text-white" },
};

/**
 * Property token card in the style of an estate-agent listing: photo with a corner ribbon,
 * the property line, a big price and a BUY button, then the area.
 * BUY only links out for a verified, live token with a Pump.fun page.
 */
export function PropertyMarketCard({ property }: { property: Property }) {
  const { token, market: m } = property;
  const ribbon = RIBBON[token.status];
  const href = `/property/${property.slug}`;
  const buyUrl = token.status === "live" && token.mintVerified ? token.pumpFunUrl : null;
  const area = locationLabel(property);

  return (
    <article className="group flex flex-col overflow-hidden rounded-md border border-[#ced4da] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_4px_14px_rgba(0,0,0,0.12)]">
      <Link href={href} className="relative block overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" tabIndex={-1} aria-hidden>
        <PropertyArt
          property={property}
          sizes="(max-width: 640px) 100vw, 300px"
          className="aspect-[16/10] w-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <span
          className={cn(
            "absolute top-[14px] -right-[34px] w-[120px] rotate-45 py-[3px] text-center text-[10px] font-bold tracking-[0.12em] uppercase shadow-sm",
            ribbon.className,
          )}
        >
          {ribbon.label}
        </span>
        {property.featured && (
          <span className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-white/95 text-d8-green shadow-sm">
            <Star className="size-3.5 fill-current" aria-label="Featured" />
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-1 px-3 pt-2 pb-2.5">
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <Link href={href} className="truncate font-semibold text-[#343a40] outline-none hover:underline focus-visible:underline">
            {property.name}
          </Link>
          <span className="shrink-0 text-xs font-bold text-d8-green">{tickerLabel(property)}</span>
        </div>

        <div className="flex items-center justify-between gap-2">
          {m?.priceUsd != null ? (
            <span className="flex items-center gap-1.5 truncate text-[22px] leading-tight font-semibold text-[#212529] tabular-nums">
              {formatPrice(m.priceUsd)}
              <MarketDataTag market={m} />
            </span>
          ) : (
            <span className="truncate text-[17px] leading-tight font-semibold text-[#868e96]">
              {token.status === "unavailable" ? "Trading paused" : token.status === "live" ? "Price pending" : "Coming soon"}
            </span>
          )}
          {buyUrl ? (
            <a
              href={buyUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Buy ${tickerLabel(property)} on Pump.fun`}
              className="shrink-0 rounded-[3px] bg-d8-green px-3 py-1 text-xs font-bold tracking-wide text-white uppercase hover:bg-d8-green-dark"
            >
              Buy
            </a>
          ) : (
            <span
              aria-disabled="true"
              title="Trading opens once the token is live and verified"
              className="shrink-0 cursor-not-allowed rounded-[3px] border border-[#ced4da] px-3 py-1 text-xs font-bold tracking-wide text-[#adb5bd] uppercase"
            >
              Buy
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-[#6c757d]">
          <span className="truncate">{area || CATEGORY_LABELS[property.category]}</span>
          {m ? (
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
              <span title="Market cap">{formatUsdCompact(m.marketCapUsd)}</span>
              <ChangeText value={m.change24hPct} />
            </span>
          ) : (
            <span className="shrink-0">{CATEGORY_LABELS[property.category]}</span>
          )}
        </div>
      </div>
    </article>
  );
}
