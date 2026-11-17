import { CATALOGUE, catalogueDescription, slugify } from "@/data/catalogue";
import { bundledPropertyImage } from "@/data/property-images";
import { toCategory, toRegionId } from "@/lib/api-client/adapter";
import type { Property } from "@/lib/types";

/**
 * MOCK CATALOGUE: what the UI renders with NEXT_PUBLIC_MOCK_API=true (no database).
 *
 * Built from the same launch catalogue the database is seeded from (src/data/catalogue.ts),
 * so mock mode and the real backend always show the same 15 listings, names, slugs and
 * district-level map placements (`precision: "approximate"`).
 *
 * Every token is "coming_soon" with no mint and no market data. Nothing here is a real
 * price. Set NEXT_PUBLIC_DEMO_MARKETS=true to preview populated states with clearly
 * labelled demo numbers (see src/lib/mock-api.ts).
 */

export { slugify };

export const MOCK_PROPERTIES: Property[] = CATALOGUE.map((entry, index) => {
  const slug = slugify(entry.name);
  const region = toRegionId(entry.region ?? null);
  return {
    id: `prop_${String(index + 1).padStart(2, "0")}`,
    slug,
    name: entry.name,
    neighbourhood: entry.neighbourhood ?? "Location to be confirmed",
    region,
    category: toCategory(entry.category, entry.typeLabel),
    description: catalogueDescription(entry),
    image: bundledPropertyImage(slug),
    featured: entry.featured ?? false,
    priority: index + 1,
    verification: {
      status: "unverified",
      note: "Proposed listing. Not yet verified as an official in-game location.",
    },
    location: entry.map ? { x: entry.map[0], y: entry.map[1], precision: "approximate" } : null,
    token: {
      ticker: entry.ticker,
      status: "coming_soon",
      mint: null,
      mintVerified: false,
      pumpFunUrl: null,
      launchedAt: null,
    },
    market: null,
  };
});
