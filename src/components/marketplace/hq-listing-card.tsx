"use client";

import { memo, useEffect, useRef } from "react";
import Image from "next/image";
import { Crown } from "lucide-react";
import { DYNASTY_HQ } from "@/data/dynasty-hq";
import { cardImage } from "@/data/property-images";
import { formatUsdCompact } from "@/lib/format";
import type { Filters } from "@/lib/filters";
import { ChangeText, MarketDataTag } from "@/components/property/badges";
import { Tag } from "@/components/ui/panel";
import { TOKEN_STATUS_LABELS } from "@/data/regions";
import { CategoryBand, listingCardFrame } from "./listing-card";
import type { EcosystemToken } from "@/lib/types";

const SEARCH_TERMS = ["dynasty", "hq", "headquarters", "main office", "main token"];

/**
 * Whether the pinned DYNASTY HQ card belongs in the list under these filters: it sits in Vice
 * City, has no property type, and matches searches for DYNASTY / HQ / its ticker.
 */
export function hqMatchesFilters(token: EcosystemToken, f: Filters): boolean {
  const q = f.query.trim().toLowerCase().replace(/^\$/, "");
  const matchesQuery =
    q === "" || token.ticker.toLowerCase().includes(q) || SEARCH_TERMS.some((t) => t.includes(q) || q.includes(t));
  return (
    matchesQuery &&
    (f.region === "all" || f.region === "vice-city") &&
    f.category === "all" &&
    (f.status === "all" || f.status === token.status)
  );
}

interface HqListingCardProps {
  token: EcosystemToken;
  selected: boolean;
  hovered: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

/** The DYNASTY Main Office (main token) pinned above the property cards, in the same layout. */
export const HqListingCard = memo(function HqListingCard({ token, selected, hovered, onSelect, onHover }: HqListingCardProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const m = token.market;

  // Keep the card visible when the HQ is selected from the map.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      aria-label={`${DYNASTY_HQ.name}, main token $${token.ticker}`}
      onClick={() => onSelect(DYNASTY_HQ.id)}
      onPointerEnter={() => onHover(DYNASTY_HQ.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(DYNASTY_HQ.id)}
      onBlur={() => onHover(null)}
      className={listingCardFrame(selected, hovered)}
    >
      <div className="relative h-[76px] w-[104px] shrink-0 overflow-hidden bg-vc-primary">
        <Image
          src={cardImage(DYNASTY_HQ.image)}
          alt=""
          fill
          sizes="104px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <CategoryBand>Headquarters</CategoryBand>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-[16px] leading-tight font-bold text-vc-text">{DYNASTY_HQ.name}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-vc-muted">
          <span className="truncate">{DYNASTY_HQ.area}</span>
          <Tag tone="gold" className="px-1.5 py-0.5 text-[10px]">
            <Crown className="size-2.5" aria-hidden /> Main token
          </Tag>
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 bg-vc-surface-3 px-2 py-1">
          <span className="truncate text-[13px] font-bold text-vc-accent">${token.ticker}</span>
          {m ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-vc-text tabular-nums">
              {formatUsdCompact(m.marketCapUsd)}
              <ChangeText value={m.change24hPct} />
              <MarketDataTag market={m} />
            </span>
          ) : (
            <span className="shrink-0 text-[11px] tracking-[0.06em] text-vc-text-2 uppercase">
              {TOKEN_STATUS_LABELS[token.status]}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
