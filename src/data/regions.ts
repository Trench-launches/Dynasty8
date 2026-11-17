import type { PropertyCategory, Region, RegionId, TokenStatus } from "@/lib/types";

/** Map world size in map units. All property locations use this coordinate space. */
export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 1600;

export const REGIONS: Region[] = [
  { id: "port-gellhorn", name: "Port Gellhorn", label: { x: 290, y: 565 } },
  { id: "ambrosia", name: "Ambrosia", label: { x: 630, y: 470 } },
  { id: "mount-kalaga", name: "Mount Kalaga", label: { x: 660, y: 215 } },
  { id: "vice-city", name: "Vice City", label: { x: 960, y: 860 } },
  { id: "grassrivers", name: "Grassrivers", label: { x: 600, y: 1000 } },
  { id: "leonida-keys", name: "Leonida Keys", label: { x: 420, y: 1438 } },
];

export const REGION_BY_ID: Record<RegionId, Region> = Object.fromEntries(
  REGIONS.map((r) => [r.id, r]),
) as Record<RegionId, Region>;

/** Display name for a region id; undefined when the listing has no region yet. */
export function regionName(id: RegionId | null | undefined): string | undefined {
  return id ? REGION_BY_ID[id]?.name : undefined;
}

export const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  motel: "Motel",
  safehouse: "Safehouse",
  apartment: "Apartment",
  house: "House",
  garage: "Garage",
  marina: "Marina",
  hotel: "Hotel",
  luxury: "Luxury",
  offices: "Offices",
  studio: "Studio",
  automotive: "Automotive",
  nightlife: "Nightlife",
  retail: "Retail",
  industrial: "Industrial",
};

export const TOKEN_STATUS_LABELS: Record<TokenStatus, string> = {
  coming_soon: "Coming Soon",
  live: "Live",
  unavailable: "Unavailable",
};
