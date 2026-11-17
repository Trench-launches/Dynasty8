/**
 * Original property photos bundled in /public/properties/<slug>.jpg (AI-generated for
 * DYNASTY; no game assets). Used whenever a listing has no image URL of its own, in
 * both mock mode and database mode. A real `imageUrl` from the backend always wins.
 *
 * To add one: drop a 3:2 JPEG at public/properties/<slug>.jpg and list the slug here.
 */
const BUNDLED = new Set<string>([
  "starlet-motel",
  "leonida-keys-safehouse",
  "bayside-safehouse",
  "jasons-stilt-house",
  "shorecourt-garage",
  "paradise-garage",
  "key-lento-marina-club",
  "ocean-view-hotel",
  "venture-apartments",
  "pegassi-residences",
  "megamundo-hq",
  "only-raw-records",
  "rideout-customs",
  "delights-cabaret",
  "brians-boat-works-and-marina",
]);

export function bundledPropertyImage(slug: string): string | null {
  return BUNDLED.has(slug) ? `/properties/${slug}.jpg` : null;
}
