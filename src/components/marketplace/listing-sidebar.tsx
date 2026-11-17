"use client";

import { SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_FILTERS, type Filters } from "@/lib/filters";
import type { Property } from "@/lib/types";
import { ListingCard } from "./listing-card";
import { FilterControls, SearchBox } from "./listing-filters";

interface ListingSidebarProps {
  visible: Property[];
  total: number;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  selectedSlug: string | null;
  hoveredSlug: string | null;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
  className?: string;
}

export function ListingSidebar({
  visible,
  total,
  filters,
  onFiltersChange,
  selectedSlug,
  hoveredSlug,
  onSelect,
  onHover,
  className,
}: ListingSidebarProps) {
  const unmapped = visible.filter((p) => !p.location).length;
  const demo = visible.some((p) => p.market?.source === "demo");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="space-y-3 border-b border-white/10 p-4 pb-3">
        <div className="flex items-end justify-between gap-2">
          <h1 className="font-display text-[34px] leading-none tracking-[0.06em] text-white">
            PROPERTY <span className="text-sunset-gradient">LISTINGS</span>
          </h1>
          <p className="pb-0.5 text-[11px] font-semibold text-white/45 tabular-nums" aria-live="polite">
            {visible.length} of {total}
          </p>
        </div>
        <SearchBox filters={filters} onChange={onFiltersChange} />
        <FilterControls filters={filters} onChange={onFiltersChange} />
      </div>

      {demo && (
        <p className="border-b border-neon/30 bg-neon/10 px-4 py-2 text-[11px] text-neon">
          Demo mode: market figures are generated for design preview and are not real.
        </p>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3" role="list" aria-label="Properties">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <SearchX className="size-8 text-white/30" />
            <p className="font-display text-2xl tracking-wide text-white/80">NO PROPERTIES FOUND</p>
            <p className="text-sm text-white/50">Nothing matches those filters. Try a different area or clear the search.</p>
            <button
              type="button"
              onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
              className="mt-1 rounded-md bg-sunset-gradient px-4 py-2 text-sm font-bold text-ink"
            >
              Clear filters
            </button>
          </div>
        ) : (
          visible.map((p) => (
            <div role="listitem" key={p.slug}>
              <ListingCard
                property={p}
                selected={p.slug === selectedSlug}
                hovered={p.slug === hoveredSlug}
                onSelect={onSelect}
                onHover={onHover}
              />
            </div>
          ))
        )}
        {unmapped > 0 && (
          <p className="px-2 pt-2 text-[11px] text-white/40">
            {unmapped} listing{unmapped === 1 ? "" : "s"} without an agreed map placement {unmapped === 1 ? "is" : "are"} shown here only.
          </p>
        )}
      </div>

      <p className="border-t border-white/10 px-4 py-3 text-[10px] leading-relaxed text-white/40">
        Property tokens are themed digital collectibles traded on Pump.fun. Holding one does not grant ownership of any
        real or in-game property. Not affiliated with Rockstar Games or Take-Two Interactive.
      </p>
    </div>
  );
}
