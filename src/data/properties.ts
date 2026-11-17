import type { Property, PropertyCategory, RegionId } from "@/lib/types";

/**
 * MOCK CATALOGUE — stands in for GET /api/properties until the backend is live.
 *
 * The 15 entries are the confirmed initial marketplace batch (ticker + type).
 * Display names come from the frontend brief where it had one; RIDEOUT, DELIGHTS and
 * BOATWORKS only had a ticker and type, so their names and regions are provisional.
 *
 * Map positions are district-level placements on our own illustrated map
 * (`precision: "approximate"`), not exact in-game plots. Set `location: null`
 * for anything that should stay off the map until its placement is agreed.
 *
 * Every token is "coming_soon" with no mint and no market data — nothing here is a
 * real price. Set NEXT_PUBLIC_DEMO_MARKETS=true to preview populated states with
 * clearly labelled demo numbers (see src/lib/mock-api.ts).
 */

interface Seed {
  name: string;
  neighbourhood: string;
  region: RegionId;
  category: PropertyCategory;
  ticker: string;
  description: string;
  featured?: boolean;
  location: [number, number] | null;
}

const CATALOGUE: Seed[] = [
  {
    name: "Starlet Motel",
    neighbourhood: "Port Gellhorn",
    region: "port-gellhorn",
    category: "motel",
    ticker: "STARLET",
    featured: true,
    location: [302, 362],
    description:
      "A roadside motel with a flickering neon sign, a drained pool and a parking lot that has seen things. The Gulf-coast hideout that started it all.",
  },
  {
    name: "Leonida Keys Safehouse",
    neighbourhood: "Leonida Keys",
    region: "leonida-keys",
    category: "safehouse",
    ticker: "KEYS",
    location: [668, 1418],
    description:
      "A low-slung island bungalow off the overseas highway. Shutters, a screened porch and a boat ramp for quick departures.",
  },
  {
    name: "Bayside Safehouse",
    neighbourhood: "Vice City",
    region: "vice-city",
    category: "apartment",
    ticker: "BAYSIDE",
    location: [1014, 1002],
    description:
      "A quiet walk-up apartment on the bay with skyline views across the water and an easy line to the causeway.",
  },
  {
    name: "Jason's Stilt House",
    neighbourhood: "Leonida Keys",
    region: "leonida-keys",
    category: "house",
    ticker: "STILT",
    featured: true,
    location: [538, 1478],
    description:
      "A weathered stilt house standing over the shallows, reachable by boat or a long wooden jetty. Sunsets included.",
  },
  {
    name: "Shorecourt Garage",
    neighbourhood: "Vice City",
    region: "vice-city",
    category: "garage",
    ticker: "SHORE",
    location: [982, 1172],
    description:
      "A covered courtyard garage a few blocks from the waterfront, with room for a small collection and no questions asked.",
  },
  {
    name: "Paradise Garage",
    neighbourhood: "Vice City",
    region: "vice-city",
    category: "garage",
    ticker: "PARADISE",
    location: [888, 1010],
    description:
      "A sun-bleached body shop with a hand-painted sign, roll-up doors and a back office that never seems to close.",
  },
  {
    name: "Key Lento Marina Club",
    neighbourhood: "Key Lento, Leonida Keys",
    region: "leonida-keys",
    category: "marina",
    ticker: "LENTO",
    location: [600, 1446],
    description:
      "A members' marina with fuel docks, a tiki bar and slips for everything from fishing skiffs to offshore racers.",
  },
  {
    name: "Ocean View Hotel",
    neighbourhood: "Ocean Beach, Vice City",
    region: "vice-city",
    category: "hotel",
    ticker: "OCEAN",
    featured: true,
    location: [1088, 1080],
    description:
      "A pastel art deco hotel on the beachfront strip, with a rooftop sign that glows pink after dark.",
  },
  {
    name: "Venture Apartments",
    neighbourhood: "Vice City",
    region: "vice-city",
    category: "apartment",
    ticker: "VENTURE",
    location: [940, 958],
    description:
      "A mid-century apartment block with breezeway balconies, a courtyard pool and a view of the bay bridges.",
  },
  {
    name: "Pegassi Residences",
    neighbourhood: "Ocean Beach, Vice City",
    region: "vice-city",
    category: "luxury",
    ticker: "PEGASSI",
    location: [1082, 976],
    description:
      "Glass-fronted luxury residences on the north end of the beach, with valet parking and a private pool deck.",
  },
  {
    name: "Megamundo HQ",
    neighbourhood: "Downtown Vice City",
    region: "vice-city",
    category: "offices",
    ticker: "MEGA",
    location: [992, 1050],
    description:
      "A downtown office tower with a rooftop helipad and a lobby built to impress investors who ask few questions.",
  },
  {
    name: "Only Raw Records",
    neighbourhood: "Vice City",
    region: "vice-city",
    category: "studio",
    ticker: "RAW",
    location: [928, 1100],
    description:
      "An independent record label and studio with soundproofed booths, a lounge and a loading bay out back.",
  },
  {
    name: "Rideout Automotive",
    neighbourhood: "Ambrosia",
    region: "ambrosia",
    category: "automotive",
    ticker: "RIDEOUT",
    location: [776, 476],
    description:
      "A highway-side automotive shop with a dyno bay, a paint booth and a forecourt full of projects. Name and location provisional.",
  },
  {
    name: "Delights Nightlife",
    neighbourhood: "Ocean Beach, Vice City",
    region: "vice-city",
    category: "nightlife",
    ticker: "DELIGHTS",
    location: [1086, 1150],
    description:
      "A neon-soaked club on the beach strip with a velvet rope, a rooftop terrace and a bass line you can feel from the causeway. Name and location provisional.",
  },
  {
    name: "Boatworks Marina",
    neighbourhood: "Port Gellhorn",
    region: "port-gellhorn",
    category: "marina",
    ticker: "BOATWORKS",
    location: [248, 386],
    description:
      "A working boatyard and marina on the Port Gellhorn harbour, with slipways, a dry stack and a chandlery. Name and location provisional.",
  },
];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const MOCK_PROPERTIES: Property[] = CATALOGUE.map((seed, index) => ({
  id: `prop_${String(index + 1).padStart(2, "0")}`,
  slug: slugify(seed.name),
  name: seed.name,
  neighbourhood: seed.neighbourhood,
  region: seed.region,
  category: seed.category,
  description: seed.description,
  image: null,
  featured: seed.featured ?? false,
  priority: index + 1,
  verification: {
    status: "unverified",
    note: "In the confirmed launch batch. Not yet verified as an official in-game location.",
  },
  location: seed.location ? { x: seed.location[0], y: seed.location[1], precision: "approximate" } : null,
  token: {
    ticker: seed.ticker,
    status: "coming_soon",
    mint: null,
    mintVerified: false,
    pumpFunUrl: null,
    launchedAt: null,
  },
  market: null,
}));
