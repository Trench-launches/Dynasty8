"use client";

import { SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_FILTERS, type Filters } from "@/lib/filters";
import { DYNASTY_HQ } from "@/data/dynasty-hq";
import type { EcosystemToken, Property } from "@/lib/types";
import { HqListingCard, hqMatchesFilters } from "./hq-listing-card";
import { ListingCard } from "./listing-card";
import { FilterControls, SearchBox } from "./listing-filters";
import { PanelHeader } from "@/components/ui/panel";

interface ListingSidebarProps {
  visible: Property[];
  total: number;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  selectedSlug: string | null;
  hoveredSlug: string | null;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
  /** The $DYNASTY main token: its DYNASTY HQ card is pinned above the properties. */
  hqToken?: EcosystemToken | null;
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
  hqToken = null,
  className,
}: ListingSidebarProps) {
  const unmapped = visible.filter((p) => !p.location).length;
  const showHq = hqToken != null && hqMatchesFilters(hqToken, filters);
  const demo = visible.some((p) => p.market?.source === "demo");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <PanelHeader as="h1" title="Property listings" note={`${visible.length + (showHq ? 1 : 0)} listed`} />
      <div className="space-y-3 border-b border-[#e3e3e3] p-4 pt-3 pb-3">
        {/* Result count for screen readers only; not shown visually. */}
        <p className="sr-only" aria-live="polite">
          {visible.length} of {total} properties shown
        </p>
        <SearchBox filters={filters} onChange={onFiltersChange} />
        <FilterControls filters={filters} onChange={onFiltersChange} />
      </div>

      {demo && (
        <p className="border-b border-neon/30 bg-neon/10 px-4 py-2 text-[11px] text-neon">
          Demo mode: market figures are generated for design preview and are not real.
        </p>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto bg-d8-paper p-3" role="list" aria-label="Properties">
        {showHq && (
          <div role="listitem">
            <HqListingCard
              token={hqToken}
              selected={selectedSlug === DYNASTY_HQ.id}
              hovered={hoveredSlug === DYNASTY_HQ.id}
              onSelect={onSelect}
              onHover={onHover}
            />
          </div>
        )}
        {visible.length === 0 && showHq ? (
          // The HQ card above already matched, so a full "nothing found" block would contradict it.
          <p className="px-2 pt-2 text-[11px] text-[#868e96]">
            No properties match these filters.{" "}
            <button
              type="button"
              onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
              className="font-semibold text-tropic underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          </p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <SearchX className="size-8 text-[#adb5bd]" />
            <p className="text-[21px] tracking-[0.04em] text-d8-green uppercase">No properties found</p>
            <p className="text-sm text-[#6c757d]">Nothing matches those filters. Try a different area or clear the search.</p>
            <button
              type="button"
              onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
              className="mt-1 rounded-full bg-d8-green px-6 py-2.5 text-[15px] tracking-[0.02em] text-white uppercase hover:bg-d8-green-dark"
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
          <p className="px-2 pt-2 text-[11px] text-[#868e96]">
            {unmapped} listing{unmapped === 1 ? "" : "s"} without an agreed map placement {unmapped === 1 ? "is" : "are"} shown here only.
          </p>
        )}
      </div>
    </div>
  );
}
