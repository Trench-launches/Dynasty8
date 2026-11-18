/**
 * Original property photos bundled in /public/properties/<slug>-v2.jpg (AI-generated for
 * DYNASTY; no game assets). Used whenever a listing has no image URL of its own, in
 * both mock mode and database mode. A real `imageUrl` from the backend always wins.
 *
 * To add one: drop a 3:2 JPEG at public/properties/<slug>-v2.jpg and list the slug here.
 * (Bump the -vN suffix when replacing photos so browser and image caches pick up the new file.)
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

/**
 * The pre-sized card copy of a bundled photo (public/properties/*-sm.webp, made by
 * scripts/make-thumbnails.mjs). Any other URL is returned unchanged.
 */
export function cardImage(src: string): string {
  return /^\/(properties|brand)\/[^/]+\.jpe?g$/i.test(src) ? src.replace(/\.jpe?g$/i, "-sm.webp") : src;
}

export function bundledPropertyImage(slug: string): string | null {
  return BUNDLED.has(slug) ? `/properties/${slug}-v2.jpg` : null;
}
