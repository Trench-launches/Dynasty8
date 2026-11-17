import { CATEGORY_LABELS, regionName } from "@/data/regions";
import type { Property, PropertyCategory, RegionId, TokenStatus } from "@/lib/types";

export type SortKey = "featured" | "market_cap" | "volume" | "change" | "name";

export interface Filters {
  query: string;
  region: RegionId | "all";
  category: PropertyCategory | "all";
  status: TokenStatus | "all";
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  region: "all",
  category: "all",
  status: "all",
  sort: "featured",
};

export const SORT_LABELS: Record<SortKey, string> = {
  featured: "Featured first",
  market_cap: "Market cap",
  volume: "24h volume",
  change: "24h performance",
  name: "Name A–Z",
};

export function hasActiveFilters(f: Filters): boolean {
  return f.query.trim() !== "" || f.region !== "all" || f.category !== "all" || f.status !== "all";
}

function matchesQuery(p: Property, q: string): boolean {
  if (!q) return true;
  const haystack = [
    p.name,
    p.neighbourhood,
    regionName(p.region),
    CATEGORY_LABELS[p.category],
    p.token.ticker ?? "",
    p.token.ticker ? `$${p.token.ticker}` : "",
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function featuredRank(p: Property): number {
  if (p.featured) return 0;
  return p.priority != null ? 1 : 2;
}

function byFeatured(a: Property, b: Property): number {
  return (
    featuredRank(a) - featuredRank(b) ||
    (a.priority ?? 999) - (b.priority ?? 999) ||
    a.name.localeCompare(b.name)
  );
}

/** Market sorts: listings without market data always sink to the bottom. */
function byMarket(pick: (p: Property) => number | null | undefined) {
  return (a: Property, b: Property) => {
    const va = pick(a);
    const vb = pick(b);
    if (va == null && vb == null) return byFeatured(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va;
  };
}

const SORTERS: Record<SortKey, (a: Property, b: Property) => number> = {
  featured: byFeatured,
  market_cap: byMarket((p) => p.market?.marketCapUsd),
  volume: byMarket((p) => p.market?.volume24hUsd),
  change: byMarket((p) => p.market?.change24hPct),
  name: (a, b) => a.name.localeCompare(b.name),
};

export function applyFilters(properties: Property[], f: Filters): Property[] {
  const q = f.query.trim();
  return properties
    .filter(
      (p) =>
        (f.region === "all" || p.region === f.region) &&
        (f.category === "all" || p.category === f.category) &&
        (f.status === "all" || p.token.status === f.status) &&
        matchesQuery(p, q),
    )
    .sort(SORTERS[f.sort]);
}
