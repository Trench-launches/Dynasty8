"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin, MapPinOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/data/regions";
import { formatPrice, formatUsdCompact, locationLabel, shortAddress, tickerLabel } from "@/lib/format";
import { useMarket } from "@/hooks/use-market";
import { PropertyArt } from "@/components/property/property-art";
import { CategoryBand } from "./listing-card";
import {
  ChangeText,
  MarketDataTag,
  FeaturedBadge,
  TokenStatusBadge,
  VerificationBadge,
} from "@/components/property/badges";
import type { Property } from "@/lib/types";

interface PropertyPreviewProps {
  property: Property;
  onClose: () => void;
  compact?: boolean;
  className?: string;
}

/** Selected-property details. Keep keyed by slug so market state resets per property. */
export function PropertyPreview({ property, onClose, compact = false, className }: PropertyPreviewProps) {
  const { market, status } = useMarket(property.slug, property.market);
  const token = property.token;
  const tradeUrl = token.mintVerified ? token.pumpFunUrl : null;

  return (
    <article className={cn("flex flex-col", className)} aria-label={`${property.name} details`}>
      <div className={cn("relative shrink-0 overflow-hidden", compact ? "h-36" : "h-52")}>
        <PropertyArt property={property} sizes="(max-width: 1024px) 100vw, 380px" className="h-full w-full" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-vc-surface/95 text-vc-text backdrop-blur hover:bg-vc-surface/95 hover:text-vc-text"
        >
          <X className="size-4" />
        </button>
        <CategoryBand className="py-1 text-[19px]">{CATEGORY_LABELS[property.category]}</CategoryBand>
        <div className="absolute top-2.5 left-3 flex flex-wrap gap-1.5">
          {/* The live badge keeps its solid green; only the pale badges get a white backing over the photo. */}
          <TokenStatusBadge status={token.status} className={token.status === "live" ? undefined : "bg-vc-surface/95 backdrop-blur"} />
          {property.featured && <FeaturedBadge className="bg-vc-surface/95 backdrop-blur" />}
        </div>
      </div>

      <div className="space-y-4 p-5 pt-3">
        <header>
          <h2 className="text-[28px] leading-tight font-bold text-vc-text">{property.name}</h2>
          <p className="mt-1.5 flex items-center gap-1 text-[16px] text-vc-text-2">
            <MapPin className="size-3.5" /> {locationLabel(property)}
          </p>
        </header>

        {!compact && <p className="text-[16px] leading-relaxed text-vc-text-2">{property.description}</p>}

        <section className="border-2 border-vc-violet bg-vc-surface-2 p-3.5" aria-label="Token market">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[20px] leading-none font-bold text-vc-text uppercase">{tickerLabel(property)}</p>
            <MarketDataTag market={market} />
          </div>
          {market ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Stat label="Price" value={formatPrice(market.priceUsd)} />
              <Stat label="Market cap" value={formatUsdCompact(market.marketCapUsd)} />
              <Stat label="24h change" value={<ChangeText value={market.change24hPct} />} />
              <Stat label="24h volume" value={formatUsdCompact(market.volume24hUsd)} />
            </dl>
          ) : (
            <p className="mt-2 text-sm text-vc-muted">
              {status === "loading"
                ? "Checking market…"
                : status === "error"
                  ? "Market data is temporarily unavailable."
                  : token.status === "unavailable"
                    ? "This token is currently unavailable."
                    : "Market data appears once the token launches on Pump.fun."}
            </p>
          )}
          <p className="mt-3 text-[11px] text-vc-faint">
            Mint: {token.mint && token.mintVerified ? <span className="font-mono">{shortAddress(token.mint)}</span> : "pending verification"}
          </p>
        </section>

        <div className="space-y-1">
          {property.location ? (
            <p className="flex items-center gap-1 text-[11px] text-vc-muted">
              <MapPin className="size-3.5" />
              {property.location.precision === "exact" ? "Exact map placement" : "Approximate district placement"}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-[11px] text-vc-muted">
              <MapPinOff className="size-3.5" /> Map placement pending
            </p>
          )}
          <VerificationBadge property={property} />
        </div>

        <div className="flex flex-col gap-2">
          <Link
            href={`/property/${property.slug}`}
            className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full bg-vc-primary px-5 text-[15px] tracking-[0.02em] text-white uppercase transition-colors hover:bg-vc-primary-strong"
          >
            View Property <ArrowRight className="size-4 shrink-0" />
          </Link>
          {tradeUrl ? (
            <a
              href={tradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full border-2 border-vc-violet bg-vc-surface px-5 text-[15px] tracking-[0.02em] text-vc-accent uppercase transition-colors hover:bg-vc-surface-2"
            >
              View Market <ExternalLink className="size-4 shrink-0" />
            </a>
          ) : (
            <span className="inline-flex h-11 min-w-0 items-center justify-center rounded-full border-2 border-dashed border-vc-line-strong px-4 text-[13px] tracking-[0.04em] text-vc-muted uppercase">
              Market link pending
            </span>
          )}
        </div>

      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-vc-line bg-vc-surface px-2.5 py-2">
      <dt className="text-[10px] tracking-[0.06em] text-vc-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-bold text-vc-text tabular-nums">{value}</dd>
    </div>
  );
}
