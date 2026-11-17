"use client";

import { memo, useEffect, useRef } from "react";
import { MapPinOff, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS } from "@/data/regions";
import { formatUsdCompact, tickerLabel } from "@/lib/format";
import { PropertyArt } from "@/components/property/property-art";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import type { Property } from "@/lib/types";

interface ListingCardProps {
  property: Property;
  selected: boolean;
  hovered: boolean;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
}

export const ListingCard = memo(function ListingCard({ property, selected, hovered, onSelect, onHover }: ListingCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const m = property.market;

  // Keep the selected card visible when the selection comes from the map.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(property.slug)}
      onPointerEnter={() => onHover(property.slug)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(property.slug)}
      onBlur={() => onHover(null)}
      className={cn(
        "group relative flex w-full gap-3 rounded-xl border p-2 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-sunset/60 bg-gradient-to-r from-sunset/15 to-transparent"
          : hovered
            ? "border-[#dee2e6] bg-[#f8f9fa]"
            : "border-transparent bg-[#f8f9fa] hover:border-[#dee2e6] hover:bg-[#f8f9fa]",
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sunset" />}
      <div className="relative h-[64px] w-[84px] shrink-0 overflow-hidden rounded-lg bg-[#f8f9fa]">
        <PropertyArt property={property} sizes="84px" className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
        {property.featured && (
          <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-white/95 text-tropic">
            <Star className="size-3 fill-current" aria-label="Featured" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-display text-[16px] leading-tight text-cream">{property.name}</p>
          {!property.location && (
            <MapPinOff className="mt-1 size-3.5 shrink-0 text-[#868e96]" aria-label="Map placement pending" />
          )}
        </div>
        <p className="truncate text-[11px] text-[#6c757d]">
          {property.neighbourhood} · {CATEGORY_LABELS[property.category]}
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-extrabold tracking-wide text-tropic">{tickerLabel(property)}</span>
          {m ? (
            <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
              <span className="text-[#212529]">{formatUsdCompact(m.marketCapUsd)}</span>
              <ChangeText value={m.change24hPct} />
              <MarketDataTag market={m} />
            </span>
          ) : (
            <TokenStatusBadge status={property.token.status} />
          )}
        </div>
      </div>
    </button>
  );
});
