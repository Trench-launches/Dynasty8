import type { MapLocation } from "@/lib/types";

/**
 * The DYNASTY Main Office: a landmark on the map for the $DYNASTY ecosystem token. It is not a
 * property listing (no coin of its own, not in the catalogue or the database, not counted in
 * the 15). The map selects it by this id like a property, so /?p=dynasty-hq links straight to it.
 *
 * It sits in the middle of the map, just west of downtown Vice City: the exact centre is taken by
 * the downtown listings, and a landmark must not cover a property pin.
 */
export const DYNASTY_HQ = {
  id: "dynasty-hq",
  name: "Dynasty Main Office",
  area: "Vice City",
  location: { x: 610, y: 700, precision: "approximate" } satisfies MapLocation,
  /** Original AI-generated artwork (ChatGPT), 3:2 like the property photos. Bump -vN when replacing it. */
  image: "/brand/dynasty-hq-v1.jpg",
} as const;
