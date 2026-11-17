"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin, MapPinOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/data/regions";
import { formatPrice, formatUsdCompact, locationLabel, shortAddress, tickerLabel } from "@/lib/format";
import { useMarket } from "@/hooks/use-market";
import { PropertyArt } from "@/components/property/property-art";
import {
  ChangeText,
  DemoTag,
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
      <div className={cn("relative shrink-0 overflow-hidden", compact ? "h-32 rounded-t-2xl" : "h-44 rounded-t-xl")}>
        <PropertyArt property={property} className="h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#101014] via-transparent to-black/30" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur hover:bg-black/80 hover:text-white"
        >
          <X className="size-4" />
        </button>
        <div className="absolute bottom-2.5 left-3 flex flex-wrap gap-1.5">
          <TokenStatusBadge status={token.status} className="bg-black/60 backdrop-blur" />
          {property.featured && <FeaturedBadge className="bg-black/60 backdrop-blur" />}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <header>
          <p className="text-[11px] font-bold tracking-[0.18em] text-sunset uppercase">{CATEGORY_LABELS[property.category]}</p>
          <h2 className="mt-0.5 font-display text-[34px] leading-[0.95] tracking-wide text-white">{property.name}</h2>
          <p className="mt-1 flex items-center gap-1 text-sm text-white/60">
            <MapPin className="size-3.5" /> {locationLabel(property)}
          </p>
        </header>

        {!compact && <p className="text-sm leading-relaxed text-white/70">{property.description}</p>}

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-label="Token market">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sunset-gradient font-display text-2xl leading-none tracking-wide">{tickerLabel(property)}</p>
            <DemoTag market={market} />
          </div>
          {market ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Stat label="Price" value={formatPrice(market.priceUsd)} />
              <Stat label="Market cap" value={formatUsdCompact(market.marketCapUsd)} />
              <Stat label="24h change" value={<ChangeText value={market.change24hPct} />} />
              <Stat label="24h volume" value={formatUsdCompact(market.volume24hUsd)} />
            </dl>
          ) : (
            <p className="mt-2 text-sm text-white/55">
              {status === "loading"
                ? "Checking market…"
                : status === "error"
                  ? "Market data is temporarily unavailable."
                  : token.status === "unavailable"
                    ? "This token is currently unavailable."
                    : "Market data appears once the token launches on Pump.fun."}
            </p>
          )}
          <p className="mt-3 text-[11px] text-white/45">
            Mint: {token.mint && token.mintVerified ? <span className="font-mono">{shortAddress(token.mint)}</span> : "pending verification"}
          </p>
        </section>

        <div className="space-y-1">
          {property.location ? (
            <p className="flex items-center gap-1 text-[11px] text-white/55">
              <MapPin className="size-3.5" />
              {property.location.precision === "exact" ? "Exact map placement" : "Approximate district placement"}
            </p>
          ) : (
            <p className="flex items-center gap-1 text-[11px] text-white/55">
              <MapPinOff className="size-3.5" /> Map placement pending
            </p>
          )}
          <VerificationBadge property={property} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/property/${property.slug}`}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-sunset-gradient px-4 text-sm font-extrabold text-ink transition-opacity hover:opacity-90"
          >
            View property <ArrowRight className="size-4" />
          </Link>
          {tradeUrl ? (
            <a
              href={tradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-bold text-white hover:bg-white/5"
            >
              View market <ExternalLink className="size-4" />
            </a>
          ) : (
            <span className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-dashed border-white/15 px-4 text-xs font-semibold text-white/45">
              Market link pending
            </span>
          )}
        </div>

        <p className="text-[10px] leading-relaxed text-white/35">
          Themed digital collectible. Holding this token does not grant ownership of any real or in-game property.
        </p>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-black/40 px-2.5 py-2">
      <dt className="text-[10px] tracking-wider text-white/45 uppercase">{label}</dt>
      <dd className="mt-0.5 font-semibold text-white tabular-nums">{value}</dd>
    </div>
  );
}
