import type { TokenIdentity, TokenMarketData } from "@/lib/integrations/types";

export const NEIGHBOURHOODS = [
  "Rockford Hills",
  "Vinewood Hills",
  "Downtown",
  "Del Perro",
  "Vespucci",
  "Pillbox Hill",
  "Sandy Shores",
] as const;
export type Neighbourhood = (typeof NEIGHBOURHOODS)[number];

export const CATEGORIES = [
  "Apartment",
  "Penthouse",
  "Mansion",
  "Office Tower",
  "Casino Resort",
  "Beachfront",
  "Ranch",
] as const;
export type PropertyCategory = (typeof CATEGORIES)[number];

/** Which illustration the generated property artwork draws. */
export type ArtStyle =
  | "twin-towers"
  | "mansion"
  | "skyscraper"
  | "casino"
  | "midrise"
  | "hill-villa"
  | "beach-house"
  | "penthouse"
  | "lofts"
  | "ranch";

export interface PropertyArt {
  style: ArtStyle;
  /** Sky gradient, top to horizon. */
  sky: [string, string, string];
  /** Accent used for windows / neon. */
  accent: string;
}

/** Position on the custom SVG map, in map units (viewBox 0 0 1000 700). */
export interface MapPoint {
  x: number;
  y: number;
}

export interface Property {
  slug: string;
  name: string;
  /** Street address line, fictional. */
  location: string;
  neighbourhood: Neighbourhood;
  category: PropertyCategory;
  tagline: string;
  description: string;
  features: string[];
  /** Illustrative only: no on-chain or legal meaning. */
  floorAreaSqFt: number;
  bedrooms: number | null;
  garageSpaces: number;
  position: MapPoint;
  art: PropertyArt;
  token: TokenIdentity;
  market: TokenMarketData;
  listedAt: string;
}

export type SortKey = "marketCap" | "change24h" | "volume" | "name";
