/**
 * Data access layer. Pages call these async functions; today they read the mock
 * file, later they can call an indexer or Pump.fun without changing callers.
 */
import { ECOSYSTEM_TOKEN, PROPERTIES } from "@/data/properties";
import type { Property, PropertyCategory, Neighbourhood, SortKey } from "@/data/types";

export async function getProperties(): Promise<Property[]> {
  return PROPERTIES;
}

export async function getProperty(slug: string): Promise<Property | null> {
  return PROPERTIES.find((p) => p.slug === slug) ?? null;
}

export async function getEcosystemToken() {
  return ECOSYSTEM_TOKEN;
}

export function getPropertySlugs(): string[] {
  return PROPERTIES.map((p) => p.slug);
}

export interface PropertyFilters {
  query: string;
  neighbourhood: Neighbourhood | "all";
  category: PropertyCategory | "all";
  sort: SortKey;
}

export const DEFAULT_FILTERS: PropertyFilters = {
  query: "",
  neighbourhood: "all",
  category: "all",
  sort: "marketCap",
};

export function applyFilters(list: Property[], f: PropertyFilters): Property[] {
  const q = f.query.trim().toLowerCase();
  const out = list.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q) && !p.market.ticker.toLowerCase().includes(q.replace(/^\$/, ""))) {
      return false;
    }
    if (f.neighbourhood !== "all" && p.neighbourhood !== f.neighbourhood) return false;
    if (f.category !== "all" && p.category !== f.category) return false;
    return true;
  });
  const sorters: Record<SortKey, (a: Property, b: Property) => number> = {
    marketCap: (a, b) => b.market.marketCapUsd - a.market.marketCapUsd,
    change24h: (a, b) => b.market.change24hPct - a.market.change24hPct,
    volume: (a, b) => b.market.volume24hUsd - a.market.volume24hUsd,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return [...out].sort(sorters[f.sort]);
}
