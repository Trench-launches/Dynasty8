"use client";

import { LayoutGrid, Map as MapIcon, Search, X } from "lucide-react";
import { CATEGORIES, NEIGHBOURHOODS, type SortKey } from "@/data/types";
import type { PropertyFilters } from "@/lib/data";
import { cn } from "@/lib/utils";

export type ViewMode = "map" | "grid";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "marketCap", label: "Market cap" },
  { value: "change24h", label: "24h performance" },
  { value: "volume", label: "Volume" },
  { value: "name", label: "Name A–Z" },
];

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="relative flex min-w-0 flex-col">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-10 w-full min-w-0 cursor-pointer appearance-none rounded-xl bg-white pl-3 pr-8 text-sm font-bold text-violet ring-1 ring-violet/12 outline-none hover:ring-sunset/60 focus:ring-2 focus:ring-neon"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-violet/60"
        aria-hidden
      >
        <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </label>
  );
}

export function FilterBar({
  filters,
  onChange,
  view,
  onViewChange,
  resultCount,
}: {
  filters: PropertyFilters;
  onChange: (f: PropertyFilters) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  resultCount: number;
}) {
  const set = <K extends keyof PropertyFilters>(k: K, v: PropertyFilters[K]) => onChange({ ...filters, [k]: v });
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative flex-1 lg:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-violet/50" aria-hidden />
        <input
          type="search"
          value={filters.query}
          onChange={(e) => set("query", e.target.value)}
          placeholder="Search properties or $TICKER"
          aria-label="Search properties by name"
          className="h-10 w-full rounded-xl bg-white pl-9 pr-9 text-sm font-semibold text-violet ring-1 ring-violet/12 outline-none placeholder:text-violet/40 focus:ring-2 focus:ring-neon [&::-webkit-search-cancel-button]:hidden"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => set("query", "")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-violet/60 hover:bg-violet/8"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 lg:flex lg:flex-1">
        <Select
          label="Filter by neighbourhood"
          value={filters.neighbourhood}
          onChange={(v) => set("neighbourhood", v)}
          options={[{ value: "all", label: "All areas" }, ...NEIGHBOURHOODS.map((n) => ({ value: n, label: n }))]}
        />
        <Select
          label="Filter by category"
          value={filters.category}
          onChange={(v) => set("category", v)}
          options={[{ value: "all", label: "All types" }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
        />
        <Select
          label="Sort by"
          value={filters.sort}
          onChange={(v) => set("sort", v)}
          options={SORTS.map((s) => ({ value: s.value, label: `Sort: ${s.label}` }))}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-violet/55 lg:hidden" aria-live="polite">
          {resultCount} {resultCount === 1 ? "property" : "properties"}
        </span>
        <div className="flex rounded-xl bg-white p-1 ring-1 ring-violet/12" role="group" aria-label="View mode">
          {(
            [
              { v: "map", label: "Map", Icon: MapIcon },
              { v: "grid", label: "Grid", Icon: LayoutGrid },
            ] as const
          ).map(({ v, label, Icon }) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onViewChange(v)}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-extrabold transition-colors",
                view === v ? "bg-sunset text-white shadow" : "text-violet/65 hover:text-violet",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {v === "grid" ? (
                <>
                  <span className="lg:hidden">List</span>
                  <span className="hidden lg:inline">{label}</span>
                </>
              ) : (
                label
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
