/**
 * Branding lives here so the marketplace can be renamed in one place.
 * Every visible use of the brand name, tagline and map label reads from this object.
 */
export const brand = {
  /** Full display name. Placeholder until the final name is chosen. */
  name: "DYNASTY 8",
  /** Word part and numeral part, rendered separately in the logo lockup. */
  wordmark: "DYNASTY",
  numeral: "8",
  subtitle: "Real Estate",
  tagline: "The best move you'll ever make",
  /** Label shown on the map frame, in place of an in-game map brand. */
  mapLabel: "SunMaps",
  /** City names used in copy. Fictional. */
  city: "Los Soleados",
  description:
    "A GTA-inspired property token marketplace on Solana. Frontend prototype with demo data only.",
} as const;

export type Brand = typeof brand;
