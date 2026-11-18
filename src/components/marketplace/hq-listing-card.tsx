"use client";

import { memo, useEffect, useRef } from "react";
import Image from "next/image";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DYNASTY_HQ } from "@/data/dynasty-hq";
import { formatUsdCompact } from "@/lib/format";
import type { Filters } from "@/lib/filters";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
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
      className={cn(
        "group relative flex w-full gap-3 rounded-xl border p-2 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-sunset/60 bg-gradient-to-r from-sunset/15 to-transparent"
          : hovered
            ? "border-[#e0b13a] bg-[#fdf8ea]"
            : "border-[#e0b13a]/60 bg-[#fdf8ea] hover:border-[#e0b13a]",
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sunset" />}
      <div className="relative h-[64px] w-[84px] shrink-0 overflow-hidden rounded-lg bg-d8-green">
        <Image
          src={DYNASTY_HQ.image}
          alt=""
          fill
          sizes="84px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[16px] leading-tight text-cream">{DYNASTY_HQ.name}</p>
        <p className="truncate text-[11px] text-[#6c757d]">{DYNASTY_HQ.area} · Headquarters</p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs font-extrabold tracking-wide text-tropic">${token.ticker}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-[#e0b13a] px-1.5 py-px text-[9px] font-bold tracking-wider text-[#212529] uppercase">
              <Crown className="size-2.5" aria-hidden /> Main token
            </span>
          </span>
          {m ? (
            <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
              <span className="text-[#212529]">{formatUsdCompact(m.marketCapUsd)}</span>
              <ChangeText value={m.change24hPct} />
              <MarketDataTag market={m} />
            </span>
          ) : (
            <TokenStatusBadge status={token.status} />
          )}
        </div>
      </div>
    </button>
  );
});
