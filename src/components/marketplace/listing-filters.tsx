"use client";

import { Search, X } from "lucide-react";
import { CATEGORY_LABELS, REGIONS, TOKEN_STATUS_LABELS } from "@/data/regions";
import { DEFAULT_FILTERS, SORT_LABELS, hasActiveFilters, type Filters, type SortKey } from "@/lib/filters";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PropertyCategory, RegionId, TokenStatus } from "@/lib/types";

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
}

export function SearchBox({ filters, onChange, className }: Props & { className?: string }) {
  return (
    <div className={className}>
      <label className="relative block">
        <span className="sr-only">Search properties</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#868e96]" />
        <Input
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          placeholder="Search name, area or $TICKER"
          className="h-10 border-[#dee2e6] bg-white/95 pr-9 pl-9 text-sm placeholder:text-[#adb5bd]"
        />
        {filters.query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange({ ...filters, query: "" })}
            className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-[#6c757d] hover:text-[#212529]"
          >
            <X className="size-3.5" />
          </button>
        )}
      </label>
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
      <SelectTrigger aria-label={label} size="sm" className="h-8 w-full border-[#dee2e6] bg-[#f8f9fa] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border border-[#dee2e6] bg-white">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterControls({ filters, onChange }: Props) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <FilterSelect<RegionId | "all">
          label="Region"
          value={filters.region}
          onValueChange={(v) => set("region", v)}
          options={[{ value: "all", label: "All regions" }, ...REGIONS.map((r) => ({ value: r.id, label: r.name }))]}
        />
        <FilterSelect<PropertyCategory | "all">
          label="Property type"
          value={filters.category}
          onValueChange={(v) => set("category", v)}
          options={[
            { value: "all", label: "All types" },
            ...(Object.keys(CATEGORY_LABELS) as PropertyCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
          ]}
        />
        <FilterSelect<TokenStatus | "all">
          label="Token status"
          value={filters.status}
          onValueChange={(v) => set("status", v)}
          options={[
            { value: "all", label: "Any token status" },
            ...(Object.keys(TOKEN_STATUS_LABELS) as TokenStatus[]).map((s) => ({ value: s, label: TOKEN_STATUS_LABELS[s] })),
          ]}
        />
        <FilterSelect<SortKey>
          label="Sort by"
          value={filters.sort}
          onValueChange={(v) => set("sort", v)}
          options={(Object.keys(SORT_LABELS) as SortKey[]).map((k) => ({ value: k, label: `Sort: ${SORT_LABELS[k]}` }))}
        />
      </div>
      {hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
          className="text-[11px] font-bold tracking-[0.14em] text-sunset uppercase hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
