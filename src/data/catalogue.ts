import type { PropertyCategory } from "@/contracts/api";

/**
 * Launch catalogue: the first 15 PROPOSED listings (owner decision, 2026-11-17).
 * Single source of truth for both the database seed (prisma/seed.ts) and the frontend's
 * mock mode (src/data/properties.ts), so the two can never drift apart.
 *
 * These are catalogue proposals only:
 * - not confirmed by Rockstar, not known to be purchasable in GTA VI;
 * - no location sources yet, so every entry is CONCEPT (unverified);
 * - `map` is a district-level placement on our own illustrated map (MAP_WIDTH x MAP_HEIGHT
 *   in src/data/regions.ts), shown in the UI as "approximate". It is not an in-game plot;
 * - every token is NOT_LAUNCHED with no mint address (none have been deployed).
 * Admins upgrade verification (with sources), adjust placements and attach real mints later.
 *
 * Pure data with type-only imports: safe to import from server and client code.
 */
export interface CatalogueEntry {
  group: "A" | "B";
  name: string;
  ticker: string;
  typeLabel: string;
  category: PropertyCategory;
  /** Region id from src/data/regions.ts. */
  region?: string;
  neighbourhood?: string;
  /** Approximate [x, y] in map-world units, or omitted to keep the listing off the map. */
  map?: [number, number];
  featured?: boolean;
  /** Listing copy. Falls back to a neutral "proposed listing" text when omitted. */
  description?: string;
}

export const CATALOGUE: CatalogueEntry[] = [
  {
    group: "A",
    name: "Starlet Motel",
    ticker: "STARLET",
    typeLabel: "Motel",
    category: "SAFEHOUSE",
    region: "port-gellhorn",
    neighbourhood: "Port Gellhorn",
    map: [302, 362],
    featured: true,
    description:
      "A roadside motel with a flickering neon sign, a drained pool and a parking lot that has seen things. The Gulf-coast hideout that started it all.",
  },
  {
    group: "A",
    name: "Leonida Keys Safehouse",
    ticker: "KEYS",
    typeLabel: "Safehouse",
    category: "SAFEHOUSE",
    region: "leonida-keys",
    neighbourhood: "Leonida Keys",
    map: [668, 1418],
    description:
      "A low-slung island bungalow off the overseas highway. Shutters, a screened porch and a boat ramp for quick departures.",
  },
  {
    group: "A",
    name: "Bayside Safehouse",
    ticker: "BAYSIDE",
    typeLabel: "Apartment",
    category: "RESIDENTIAL",
    region: "vice-city",
    neighbourhood: "Vice City",
    map: [1014, 1002],
    description:
      "A quiet walk-up apartment on the bay with skyline views across the water and an easy line to the causeway.",
  },
  {
    group: "A",
    name: "Jason's Stilt House",
    ticker: "STILT",
    typeLabel: "House",
    category: "RESIDENTIAL",
    region: "leonida-keys",
    neighbourhood: "Leonida Keys",
    map: [538, 1478],
    featured: true,
    description:
      "A weathered stilt house standing over the shallows, reachable by boat or a long wooden jetty. Sunsets included.",
  },
  {
    group: "A",
    name: "Shorecourt Garage",
    ticker: "SHORE",
    typeLabel: "Garage",
    category: "GARAGE",
    region: "vice-city",
    neighbourhood: "Vice City",
    map: [982, 1172],
    description:
      "A covered courtyard garage a few blocks from the waterfront, with room for a small collection and no questions asked.",
  },
  {
    group: "A",
    name: "Paradise Garage",
    ticker: "PARADISE",
    typeLabel: "Garage",
    category: "GARAGE",
    region: "vice-city",
    neighbourhood: "Vice City",
    map: [888, 1010],
    description:
      "A sun-bleached body shop with a hand-painted sign, roll-up doors and a back office that never seems to close.",
  },
  {
    group: "A",
    name: "Key Lento Marina Club",
    ticker: "LENTO",
    typeLabel: "Marina",
    category: "MARINA",
    region: "leonida-keys",
    neighbourhood: "Key Lento, Leonida Keys",
    map: [600, 1446],
    description:
      "A members' marina with fuel docks, a tiki bar and slips for everything from fishing skiffs to offshore racers.",
  },
  {
    group: "B",
    name: "Ocean View Hotel",
    ticker: "OCEAN",
    typeLabel: "Hotel",
    category: "HOSPITALITY",
    region: "vice-city",
    neighbourhood: "Ocean Beach, Vice City",
    map: [1088, 1080],
    featured: true,
    description: "A pastel art deco hotel on the beachfront strip, with a rooftop sign that glows pink after dark.",
  },
  {
    group: "B",
    name: "Venture Apartments",
    ticker: "VENTURE",
    typeLabel: "Apartments",
    category: "RESIDENTIAL",
    region: "vice-city",
    neighbourhood: "Vice City",
    map: [940, 958],
    description:
      "A mid-century apartment block with breezeway balconies, a courtyard pool and a view of the bay bridges.",
  },
  {
    group: "B",
    name: "Pegassi Residences",
    ticker: "PEGASSI",
    typeLabel: "Luxury",
    category: "LUXURY",
    region: "vice-city",
    neighbourhood: "Ocean Beach, Vice City",
    map: [1082, 976],
    description:
      "Glass-fronted luxury residences on the north end of the beach, with valet parking and a private pool deck.",
  },
  {
    group: "B",
    name: "Megamundo HQ",
    ticker: "MEGA",
    typeLabel: "Offices",
    category: "COMMERCIAL",
    region: "vice-city",
    neighbourhood: "Downtown Vice City",
    map: [992, 1050],
    description:
      "A downtown office tower with a rooftop helipad and a lobby built to impress investors who ask few questions.",
  },
  {
    group: "B",
    name: "Only Raw Records",
    ticker: "RAW",
    typeLabel: "Studio",
    category: "COMMERCIAL",
    region: "vice-city",
    neighbourhood: "Vice City",
    map: [928, 1100],
    description:
      "An independent record label and studio with soundproofed booths, a lounge and a loading bay out back.",
  },
  {
    group: "B",
    name: "Rideout Customs",
    ticker: "RIDEOUT",
    typeLabel: "Automotive",
    category: "COMMERCIAL",
    region: "ambrosia",
    neighbourhood: "Ambrosia",
    map: [776, 476],
    description:
      "A highway-side custom shop with a dyno bay, a paint booth and a forecourt full of projects.",
  },
  {
    group: "B",
    name: "Delights Cabaret",
    ticker: "DELIGHTS",
    typeLabel: "Nightlife",
    category: "ENTERTAINMENT",
    region: "vice-city",
    neighbourhood: "Ocean Beach, Vice City",
    map: [1086, 1150],
    description:
      "A neon-soaked cabaret on the beach strip with a velvet rope, a rooftop terrace and a bass line you can feel from the causeway.",
  },
  {
    group: "B",
    name: "Brian's Boat Works & Marina",
    ticker: "BOATWORKS",
    typeLabel: "Marina",
    category: "MARINA",
    region: "port-gellhorn",
    neighbourhood: "Port Gellhorn",
    map: [248, 386],
    description:
      "A working boatyard and marina on the Port Gellhorn harbour, with slipways, a dry stack and a chandlery.",
  },
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
  return (
    e.description ??
    `${e.name} is a proposed ${e.typeLabel.toLowerCase()} listing in the Dynasty 8 catalogue. Its in-game location and details have not been verified, and it is not confirmed as an official or purchasable GTA VI property. Its token has not been launched.`
  );
}

/** Position of a slug in the launch catalogue (1 = first), or null for listings added later. */
const LAUNCH_ORDER = new Map(CATALOGUE.map((e, i) => [slugify(e.name), i + 1]));
export function launchOrder(slug: string): number | null {
  return LAUNCH_ORDER.get(slug) ?? null;
}

export const NATIVE_TOKEN = { name: "Dynasty", ticker: "DYNASTY" } as const;
