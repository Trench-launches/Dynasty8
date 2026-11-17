/**
 * Central mock data. Every component reads properties and token numbers from here
 * (through `src/lib/data.ts`). All market figures are DEMO values: fictional,
 * hand-picked, never fetched from a market, and labelled as demo in the UI.
 *
 * Holding a property token does not grant ownership of any building, rental income
 * or in-game property rights. Each property token is an independent asset.
 */
import type { TokenIdentity, TokenMarketData } from "@/lib/integrations/types";
import type { Property } from "./types";

/** Pump.fun-style tokens: 1B supply, 6 decimals. */
const PUMP_SUPPLY = 1_000_000_000;
export const DEMO_SNAPSHOT_AT = "2026-11-17T12:00:00.000Z";

function identity(name: string, ticker: string): TokenIdentity {
  return {
    name,
    ticker,
    mintAddress: null,
    pumpFunUrl: null,
    imageUrl: null,
    totalSupply: PUMP_SUPPLY,
    decimals: 6,
  };
}

function demoMarket(
  ticker: string,
  priceUsd: number,
  change24hPct: number,
  volume24hUsd: number,
  holders: number,
  bondingCurvePct: number | null,
): TokenMarketData {
  return {
    ticker,
    priceUsd,
    marketCapUsd: Math.round(priceUsd * PUMP_SUPPLY),
    change24hPct,
    volume24hUsd,
    holders,
    bondingCurvePct,
    source: "demo",
    asOf: DEMO_SNAPSHOT_AT,
  };
}

export const PROPERTIES: Property[] = [
  {
    slug: "eclipse-towers",
    name: "Eclipse Towers",
    location: "Eclipse Boulevard, Apt 31",
    neighbourhood: "Rockford Hills",
    category: "Apartment",
    tagline: "Luxury triplex in the most photographed towers in town.",
    description:
      "A move-in-ready triplex high above Eclipse Boulevard. The previous owner left in a hurry and took nothing but the dog. Floor-to-ceiling glass, a wraparound terrace facing the sunset, and a lobby doorman who has seen everything and repeats none of it.",
    features: ["Floor-to-ceiling windows", "10-car garage", "Sunset terrace", "24/7 concierge"],
    floorAreaSqFt: 4200,
    bedrooms: 3,
    garageSpaces: 10,
    position: { x: 338, y: 352 },
    art: { style: "twin-towers", sky: ["#30204F", "#FF6B9D", "#FFB36B"], accent: "#FFE6A8" },
    token: identity("Eclipse Towers", "ECLIPSE"),
    market: demoMarket("ECLIPSE", 0.000412, 12.4, 88_400, 1_284, 78),
    listedAt: "2026-10-02",
  },
  {
    slug: "richman-mansion",
    name: "Richman Mansion",
    location: "North Rockford Drive",
    neighbourhood: "Rockford Hills",
    category: "Mansion",
    tagline: "Gated estate with more gates than neighbours.",
    description:
      "Twelve bedrooms, two pools and a hedge maze that nobody has finished. Behind three sets of gates on the quietest ridge in Rockford Hills, this estate was built for people who like their privacy loud and their driveways long.",
    features: ["Two pools", "Hedge maze", "Guest house", "Helipad-ready lawn"],
    floorAreaSqFt: 14800,
    bedrooms: 12,
    garageSpaces: 8,
    position: { x: 236, y: 300 },
    art: { style: "mansion", sky: ["#2A1C4A", "#A45CFF", "#FF8066"], accent: "#FFD9A0" },
    token: identity("Richman Mansion", "RICHMAN"),
    market: demoMarket("RICHMAN", 0.000938, -4.2, 152_300, 2_041, null),
    listedAt: "2026-09-18",
  },
  {
    slug: "maze-bank-tower",
    name: "Maze Bank Tower",
    location: "Pillbox Hill Financial District",
    neighbourhood: "Pillbox Hill",
    category: "Office Tower",
    tagline: "The tallest address in the skyline. Elevator not included in token.",
    description:
      "Sixty storeys of mirrored glass at the heart of the financial district. Executive floors, a rooftop with a view of every other rooftop, and a lobby so cold you can see your breath in August.",
    features: ["Executive floors", "Rooftop access", "Private vault level", "Valet garage"],
    floorAreaSqFt: 52000,
    bedrooms: null,
    garageSpaces: 60,
    position: { x: 706, y: 498 },
    art: { style: "skyscraper", sky: ["#15152E", "#A45CFF", "#FF6B9D"], accent: "#9FE7FF" },
    token: identity("Maze Bank Tower", "MAZE"),
    market: demoMarket("MAZE", 0.00181, 6.8, 420_500, 4_512, null),
    listedAt: "2026-08-30",
  },
  {
    slug: "diamond-casino",
    name: "Diamond Casino",
    location: "Vinewood Park Drive",
    neighbourhood: "Vinewood Hills",
    category: "Casino Resort",
    tagline: "The house always wins. The token is a separate matter.",
    description:
      "A glittering resort where the carpet is loud, the chandeliers are louder and the clocks are missing on purpose. Penthouse suites, a racetrack view and a neon sign you can see from the beach.",
    features: ["Penthouse suites", "Racetrack view", "Rooftop pool", "Neon facade"],
    floorAreaSqFt: 38000,
    bedrooms: null,
    garageSpaces: 40,
    position: { x: 862, y: 342 },
    art: { style: "casino", sky: ["#30204F", "#FF6B9D", "#FF8066"], accent: "#FFF3E8" },
    token: identity("Diamond Casino", "DIAMOND"),
    market: demoMarket("DIAMOND", 0.00127, 21.3, 611_900, 3_377, null),
    listedAt: "2026-09-05",
  },
  {
    slug: "del-perro-heights",
    name: "Del Perro Heights",
    location: "Boulevard Del Perro, Apt 7",
    neighbourhood: "Del Perro",
    category: "Apartment",
    tagline: "Ocean views from the fourth best tower on the coast.",
    description:
      "A furnished corner apartment two blocks from the pier. The balcony faces the ocean, the kitchen faces the balcony, and the elevator faces a long and storied maintenance history.",
    features: ["Ocean-view balcony", "Furnished", "Walk to the pier", "Rooftop gym"],
    floorAreaSqFt: 1900,
    bedrooms: 2,
    garageSpaces: 2,
    position: { x: 182, y: 446 },
    art: { style: "midrise", sky: ["#30204F", "#FF8066", "#FFB36B"], accent: "#FFE6A8" },
    token: identity("Del Perro Heights", "DEL"),
    market: demoMarket("DEL", 0.0000874, -9.6, 21_700, 402, 34),
    listedAt: "2026-10-21",
  },
  {
    slug: "vinewood-hills",
    name: "Vinewood Hills",
    location: "Mulholland Bend",
    neighbourhood: "Vinewood Hills",
    category: "Mansion",
    tagline: "Cantilevered over the canyon, slightly over budget.",
    description:
      "A glass-and-concrete villa hanging off the hillside above the big letters. Infinity pool, screening room, and a guest wing that has hosted two award winners and one very persistent paparazzo.",
    features: ["Infinity pool", "Screening room", "Canyon views", "Guest wing"],
    floorAreaSqFt: 7600,
    bedrooms: 5,
    garageSpaces: 4,
    position: { x: 548, y: 196 },
    art: { style: "hill-villa", sky: ["#2A1C4A", "#FF6B9D", "#FFB36B"], accent: "#FFE6A8" },
    token: identity("Vinewood Hills", "VINE"),
    market: demoMarket("VINE", 0.000556, 3.1, 97_200, 1_608, 91),
    listedAt: "2026-09-27",
  },
  {
    slug: "vespucci-beach",
    name: "Vespucci Beach",
    location: "Boardwalk Row 14",
    neighbourhood: "Vespucci",
    category: "Beachfront",
    tagline: "Steps from the sand, minutes from the muscle beach.",
    description:
      "A pastel beach house right on the boardwalk. Wake up to waves, skaters and street performers; fall asleep to waves, skaters and street performers. Roof deck with a hammock and a sunset that never misses.",
    features: ["Boardwalk frontage", "Roof deck", "Outdoor shower", "Surfboard storage"],
    floorAreaSqFt: 2300,
    bedrooms: 3,
    garageSpaces: 1,
    position: { x: 290, y: 588 },
    art: { style: "beach-house", sky: ["#30204F", "#FF6B9D", "#FFB36B"], accent: "#7FE0D6" },
    token: identity("Vespucci Beach", "VESPUCCI"),
    market: demoMarket("VESPUCCI", 0.000215, 38.7, 143_000, 977, 61),
    listedAt: "2026-11-01",
  },
  {
    slug: "downtown-penthouse",
    name: "Downtown Penthouse",
    location: "Power Street, Level 48",
    neighbourhood: "Downtown",
    category: "Penthouse",
    tagline: "A whole floor, a private elevator and a skyline for a wallpaper.",
    description:
      "The full forty-eighth floor of a downtown tower with a private lift that opens straight into the living room. A wet bar, a rooftop hot tub and windows on every side so the city can admire you back.",
    features: ["Private elevator", "Rooftop hot tub", "Wet bar", "360° skyline"],
    floorAreaSqFt: 6100,
    bedrooms: 4,
    garageSpaces: 6,
    position: { x: 736, y: 520 },
    art: { style: "penthouse", sky: ["#15152E", "#30204F", "#FF6B9D"], accent: "#FFB36B" },
    token: identity("Downtown Penthouse", "PENT"),
    market: demoMarket("PENT", 0.000689, -1.4, 74_800, 1_150, 86),
    listedAt: "2026-10-12",
  },
  {
    slug: "alta-street-lofts",
    name: "Alta Street Lofts",
    location: "Alta Street, Unit 10",
    neighbourhood: "Downtown",
    category: "Apartment",
    tagline: "Exposed brick, exposed beams, exposed rent.",
    description:
      "A converted warehouse loft with industrial windows and a freight elevator that now carries only artisanal coffee. Close to everything downtown, including the noise.",
    features: ["Double-height ceilings", "Industrial windows", "Shared roof garden", "Bike storage"],
    floorAreaSqFt: 1450,
    bedrooms: 1,
    garageSpaces: 1,
    position: { x: 676, y: 466 },
    art: { style: "lofts", sky: ["#30204F", "#FF8066", "#FFB36B"], accent: "#FFD9A0" },
    token: identity("Alta Street Lofts", "ALTA"),
    market: demoMarket("ALTA", 0.0000412, 2.2, 6_900, 188, 17),
    listedAt: "2026-11-09",
  },
  {
    slug: "sandy-shores-ranch",
    name: "Sandy Shores Ranch",
    location: "Route 68 Desert Mile",
    neighbourhood: "Sandy Shores",
    category: "Ranch",
    tagline: "Forty acres of sky and one very confident windmill.",
    description:
      "A sun-bleached ranch house out past the lake, with a wraparound porch, a barn, and the kind of quiet you can only get by being nowhere near anything. Spectacular stars, questionable neighbours.",
    features: ["40 acres", "Barn and stables", "Wraparound porch", "Desert sunsets"],
    floorAreaSqFt: 2800,
    bedrooms: 3,
    garageSpaces: 3,
    position: { x: 872, y: 196 },
    art: { style: "ranch", sky: ["#30204F", "#FF8066", "#FFB36B"], accent: "#FFE6A8" },
    token: identity("Sandy Shores Ranch", "SANDY"),
    market: demoMarket("SANDY", 0.0000198, -14.9, 3_100, 96, 8),
    listedAt: "2026-11-12",
  },
];

/** Native ecosystem token. Placeholder: no mint, no market link yet. */
export const ECOSYSTEM_TOKEN = {
  identity: {
    ...identity("Realty", "REALTY"),
  } satisfies TokenIdentity,
  market: demoMarket("REALTY", 0.00342, 5.6, 1_240_000, 9_821, null),
};
