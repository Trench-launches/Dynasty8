"use client";

import { memo, useEffect, useRef } from "react";
import { MapPinOff, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, TOKEN_STATUS_LABELS } from "@/data/regions";
import { formatUsdCompact, tickerLabel } from "@/lib/format";
import { PropertyArt } from "@/components/property/property-art";
import { ChangeText, MarketDataTag } from "@/components/property/badges";
import type { Property } from "@/lib/types";

interface ListingCardProps {
  property: Property;
  selected: boolean;
  hovered: boolean;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
}

/** Shared frame for the sidebar cards: grey border, green border and pale green fill when selected. */
export const listingCardFrame = (selected: boolean, hovered: boolean) =>
  cn(
    "group relative flex w-full gap-3 border-2 p-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    selected
      ? "border-vc-violet bg-vc-surface-2"
      : hovered
        ? "border-vc-line-strong bg-vc-surface"
        : "border-vc-line bg-vc-surface hover:border-vc-line-strong",
  );

/** Yellow band across the bottom of a card photo with the property type. */
export function CategoryBand({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "absolute inset-x-0 bottom-0 truncate bg-vc-primary/95 px-1 py-0.5 text-center text-[11px] leading-tight font-bold tracking-[0.04em] text-white uppercase text-shadow-[0_1px_1px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      {children}
    </span>
  );
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
      className={listingCardFrame(selected, hovered)}
    >
      <div className="relative h-[76px] w-[104px] shrink-0 overflow-hidden bg-vc-surface-3">
        <PropertyArt property={property} sizes="104px" className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
        {property.featured && (
          <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-vc-surface/95 text-vc-accent">
            <Star className="size-3 fill-current" aria-label="Featured" />
          </span>
        )}
        <CategoryBand>{CATEGORY_LABELS[property.category]}</CategoryBand>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[16px] leading-tight font-bold text-vc-text">{property.name}</p>
          {!property.location && (
            <MapPinOff className="mt-0.5 size-3.5 shrink-0 text-vc-faint" aria-label="Map placement pending" />
          )}
        </div>
        <p className="mt-0.5 truncate text-[13px] text-vc-muted">{property.neighbourhood}</p>
        <div className="mt-auto flex items-center justify-between gap-2 bg-vc-surface-3 px-2 py-1">
          <span className="truncate text-[13px] font-bold text-vc-accent">{tickerLabel(property)}</span>
          {m ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-vc-text tabular-nums">
              {formatUsdCompact(m.marketCapUsd)}
              <ChangeText value={m.change24hPct} />
              <MarketDataTag market={m} />
            </span>
          ) : (
            <span className="shrink-0 text-[11px] tracking-[0.06em] text-vc-text-2 uppercase">
              {TOKEN_STATUS_LABELS[property.token.status]}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
