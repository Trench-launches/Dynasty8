import type { PropertyCategory } from "@prisma/client";

/**
 * Launch catalogue: the first 15 PROPOSED listings (owner decision, 2026-11-17).
 * These are catalogue proposals only:
 * - not confirmed by Rockstar, not known to be purchasable in GTA VI;
 * - no location sources yet, so every entry is CONCEPT with null map coordinates;
 * - every token is NOT_LAUNCHED with no mint address (none have been deployed).
 * Admins upgrade verification (with sources) and attach real mints later.
 */
export interface CatalogueEntry {
  group: "A" | "B";
  name: string;
  ticker: string;
  typeLabel: string;
  category: PropertyCategory;
}

export const CATALOGUE: CatalogueEntry[] = [
  { group: "A", name: "Starlet Motel", ticker: "STARLET", typeLabel: "Motel", category: "SAFEHOUSE" },
  { group: "A", name: "Leonida Keys Safehouse", ticker: "KEYS", typeLabel: "Safehouse", category: "SAFEHOUSE" },
  { group: "A", name: "Bayside Safehouse", ticker: "BAYSIDE", typeLabel: "Apartment", category: "RESIDENTIAL" },
  { group: "A", name: "Jason's Stilt House", ticker: "STILT", typeLabel: "House", category: "RESIDENTIAL" },
  { group: "A", name: "Shorecourt Garage", ticker: "SHORE", typeLabel: "Garage", category: "GARAGE" },
  { group: "A", name: "Paradise Garage", ticker: "PARADISE", typeLabel: "Garage", category: "GARAGE" },
  { group: "A", name: "Key Lento Marina Club", ticker: "LENTO", typeLabel: "Marina", category: "MARINA" },
  { group: "B", name: "Ocean View Hotel", ticker: "OCEAN", typeLabel: "Hotel", category: "HOSPITALITY" },
  { group: "B", name: "Venture Apartments", ticker: "VENTURE", typeLabel: "Apartments", category: "RESIDENTIAL" },
  { group: "B", name: "Pegassi Residences", ticker: "PEGASSI", typeLabel: "Luxury", category: "LUXURY" },
  { group: "B", name: "Megamundo HQ", ticker: "MEGA", typeLabel: "Offices", category: "COMMERCIAL" },
  { group: "B", name: "Only Raw Records", ticker: "RAW", typeLabel: "Studio", category: "COMMERCIAL" },
  { group: "B", name: "Rideout Customs", ticker: "RIDEOUT", typeLabel: "Automotive", category: "COMMERCIAL" },
  { group: "B", name: "Delights Cabaret", ticker: "DELIGHTS", typeLabel: "Nightlife", category: "ENTERTAINMENT" },
  { group: "B", name: "Brian's Boat Works & Marina", ticker: "BOATWORKS", typeLabel: "Marina", category: "MARINA" },
];

/**
 * Proposed listings held back from the first release. NOT seeded. An admin can add any of
 * them later through POST /api/admin/properties.
 */
export const RESERVE_CANDIDATES: CatalogueEntry[] = [
  { group: "A", name: "Cross Town Safehouse", ticker: "CROSSTOWN", typeLabel: "Safehouse", category: "SAFEHOUSE" },
  { group: "A", name: "Washington Beach Marina", ticker: "WBM", typeLabel: "Marina", category: "MARINA" },
  { group: "B", name: "Vercetti Estate", ticker: "ESTATE", typeLabel: "Mansion", category: "LUXURY" },
  { group: "B", name: "Stock 305", ticker: "STOCK305", typeLabel: "Retail", category: "RETAIL" },
  { group: "B", name: "Electric Fang Tattoo", ticker: "FANG", typeLabel: "Retail", category: "RETAIL" },
  { group: "B", name: "Sara's Unisex Salon", ticker: "SARA", typeLabel: "Retail", category: "RETAIL" },
  { group: "B", name: "Jack of Hearts", ticker: "JACK", typeLabel: "Nightclub", category: "ENTERTAINMENT" },
  { group: "B", name: "NINE1NINE", ticker: "919", typeLabel: "Nightclub", category: "ENTERTAINMENT" },
  { group: "B", name: "Effluvia", ticker: "EFFLUVIA", typeLabel: "Rooftop Bar", category: "HOSPITALITY" },
  { group: "B", name: "Sahara Arena", ticker: "SAHARA", typeLabel: "Entertainment", category: "ENTERTAINMENT" },
  { group: "B", name: "The Rusty Anchor", ticker: "ANCHOR", typeLabel: "Bar", category: "HOSPITALITY" },
  { group: "B", name: "Sunrise RV Park", ticker: "SUNRISE", typeLabel: "Residential", category: "RESIDENTIAL" },
  { group: "B", name: "Hank's Waffles", ticker: "HANKS", typeLabel: "Restaurant", category: "HOSPITALITY" },
  { group: "B", name: "Uncle Jack's Liquor", ticker: "UNCLEJACK", typeLabel: "Retail", category: "RETAIL" },
  { group: "B", name: "One-Eyed Willie's", ticker: "WILLIES", typeLabel: "Automotive", category: "COMMERCIAL" },
  { group: "B", name: "Allied Crystal Sugar Refinery", ticker: "SUGAR", typeLabel: "Industrial", category: "INDUSTRIAL" },
  { group: "B", name: "Ambrosia Raceway Park", ticker: "RACEWAY", typeLabel: "Motorsport", category: "ENTERTAINMENT" },
  { group: "B", name: "Thrillbilly Mud Club", ticker: "MUDCLUB", typeLabel: "Entertainment", category: "ENTERTAINMENT" },
];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function catalogueDescription(e: CatalogueEntry): string {
  return `${e.name} is a proposed ${e.typeLabel.toLowerCase()} listing in the Dynasty 8 catalogue. Its in-game location and details have not been verified, and it is not confirmed as an official or purchasable GTA VI property. Its token has not been launched.`;
}

export const NATIVE_TOKEN = { name: "Realty", ticker: "REALTY" } as const;
