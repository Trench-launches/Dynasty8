"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { Property } from "@/data/types";
import { cn, formatPrice, formatUsdCompact } from "@/lib/utils";
import { Change } from "@/components/ui/change";
import { PropertyArt } from "./property-art";

interface Props {
  property: Property;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
}

/**
 * Sidebar listing, modelled on the in-game listing column: name and ticker on top,
 * a short pitch, then numbers. The selected listing gets the golden highlight band.
 */
export const ListingCard = forwardRef<HTMLElement, Props>(function ListingCard(
  { property: p, selected, hovered, onSelect, onHover },
  ref,
) {
  return (
    <article
      ref={ref}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "group relative overflow-hidden rounded-2xl border-2 bg-white transition-all duration-200",
        selected
          ? "border-tangerine shadow-[0_10px_30px_-12px_rgba(255,128,102,0.8)]"
          : hovered
            ? "border-sunset/50 shadow-md"
            : "border-transparent shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Show ${p.name} on the map`}
        className="block w-full cursor-pointer text-left outline-none focus-visible:ring-4 focus-visible:ring-neon/50"
      >
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-3 py-2 transition-colors",
            selected ? "bg-gradient-to-r from-tangerine via-[#ffc98a] to-[#ffe2a8]" : "bg-transparent",
          )}
        >
          <h3 className="truncate font-display text-lg leading-tight tracking-wide text-violet">{p.name}</h3>
          <span className="shrink-0 rounded-full bg-midnight px-2 py-0.5 text-[11px] font-extrabold text-cream">
            ${p.market.ticker}
          </span>
        </div>
        <div className="flex gap-3 px-3 pb-3 pt-1">
          <div className="relative h-[84px] w-[112px] shrink-0 overflow-hidden rounded-xl">
            <PropertyArt art={p.art} seed={p.slug} title={`${p.name} illustration`} />
            <span className="absolute bottom-1 left-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-violet">
              {p.category}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-xs font-semibold text-violet/60">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">
                {p.location} · {p.neighbourhood}
              </span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-violet/80">{p.tagline}</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px]">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-violet/45">Mcap</p>
                <p className="font-extrabold tabular-nums text-violet">{formatUsdCompact(p.market.marketCapUsd)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-violet/45">24h</p>
                <Change value={p.market.change24hPct} className="text-[11px]" />
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-violet/45">Vol</p>
                <p className="font-extrabold tabular-nums text-violet">{formatUsdCompact(p.market.volume24hUsd)}</p>
              </div>
            </div>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between border-t border-violet/8 px-3 py-2">
        <span className="text-[11px] font-semibold text-violet/55">
          {formatPrice(p.market.priceUsd)} · <span className="text-[#9a4a10]">demo</span>
        </span>
        <Link
          href={`/property/${p.slug}`}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-extrabold text-sunset hover:bg-sunset/10"
        >
          View Property <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </article>
  );
});
