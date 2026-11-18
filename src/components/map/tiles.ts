/**
 * The GTA VI map tiles from gtadb.org ("yanis,17" set: the GTA VI Community Mapping Project
 * map), self-hosted under /public/map/leonida. Licensed CC BY 4.0 — see LEONIDA_MAP_CREDIT.
 *
 * Tile scheme (from gtadb.org's tiles.py): in-game metres, x east and y north, centred on
 * (0, 0). Zoom z has 2^(z+2) tiles of 256 px per side covering -16384..16384 m, so zoom 5
 * is 1 m per pixel. Files are named `{z}/{z},{row},{col}.jpg`.
 *
 * Map-world units (the coordinate space of property pins, see MAP_WIDTH / MAP_HEIGHT) are
 * 16 in-game metres, with the origin on the corner of the zoom-2 tile grid so every tile
 * edge falls on a whole map unit. x grows east, y grows south.
 */

import type { RegionId } from "@/lib/types";

export const LEONIDA_MAP_CREDIT = {
  text: "GTA VI Map Tiles (CC BY 4.0) — gtadb.org and the GTA VI Community Mapping Project (legend panel removed)",
  href: "https://map.gtadb.org",
  license: "https://creativecommons.org/licenses/by/4.0/",
} as const;

/** In-game metres per map unit. */
export const METRES_PER_UNIT = 16;
const WORLD_HALF = 16384;
/** In-game position of map-world (0, 0): the top-left corner of zoom-2 tile (row 2, col 2). */
const ORIGIN_X = -WORLD_HALF + 2 * 2048;
const ORIGIN_Y = WORLD_HALF - 2 * 2048;

export const TILE_ROOT = "/map/leonida";
/** Pre-stitched zoom-2 image of the whole map (2 px per map unit). */
export const BASE_IMAGE = `${TILE_ROOT}/base.jpg`;
export const BASE_ZOOM = 2;
export const MIN_DETAIL_ZOOM = 3;
export const MAX_ZOOM = 5;

/** Tile ranges per zoom for the "yanis,17" set: [[col0, row0], [col1, row1]], inclusive. */
export const TILE_RANGES: Record<number, [[number, number], [number, number]]> = {
  0: [[0, 0], [3, 3]],
  1: [[1, 1], [6, 6]],
  2: [[2, 2], [12, 12]],
  3: [[5, 5], [25, 24]],
  4: [[10, 10], [51, 49]],
  5: [[21, 21], [103, 99]],
};

/** In-game metres covered by one tile at zoom z. */
export const tileMetres = (z: number) => 256 * 2 ** (5 - z);
/** Map units covered by one tile at zoom z. */
export const tileUnits = (z: number) => tileMetres(z) / METRES_PER_UNIT;
/** Texture pixels per map unit at zoom z. */
export const pixelsPerUnit = (z: number) => 256 / tileUnits(z);

/** In-game coordinates (metres, y north) -> map-world units (y south). */
export function fromGame(x: number, y: number): { x: number; y: number } {
  return { x: (x - ORIGIN_X) / METRES_PER_UNIT, y: (ORIGIN_Y - y) / METRES_PER_UNIT };
}

/** Map-world rectangle covered by tile (z, row, col). */
export function tileRect(z: number, row: number, col: number) {
  const s = tileUnits(z);
  return {
    x: (-WORLD_HALF + col * tileMetres(z) - ORIGIN_X) / METRES_PER_UNIT,
    y: (ORIGIN_Y - (WORLD_HALF - row * tileMetres(z))) / METRES_PER_UNIT,
    w: s,
    h: s,
  };
}

// Commas are sent percent-encoded: Cloudflare's static asset server answers a raw "," with a redirect
// to the encoded form, which would add a round trip per tile. Node serves both forms.
export const tileUrl = (z: number, row: number, col: number) => `${TILE_ROOT}/${z}/${z}%2C${row}%2C${col}.jpg`;

/** The island (with the Keys) in map units: what the camera frames at home. */
export const ISLAND_VIEW = { x: 160, y: 170, w: 790, h: 1060 } as const;

/** Camera framing for the region quick-jump buttons, in map units. */
export const REGION_FOCUS: Record<RegionId, { x: number; y: number; span: number }> = {
  "port-gellhorn": { x: 360, y: 545, span: 260 },
  "mount-kalaga": { x: 555, y: 355, span: 420 },
  ambrosia: { x: 605, y: 525, span: 260 },
  "vice-city": { x: 770, y: 740, span: 300 },
  grassrivers: { x: 540, y: 985, span: 300 },
  "leonida-keys": { x: 585, y: 1150, span: 260 },
};

/** The whole tiled area in map units (the extent of the zoom-2 grid). */
export const TILED_AREA = (() => {
  const [[c0, r0], [c1, r1]] = TILE_RANGES[BASE_ZOOM];
  const a = tileRect(BASE_ZOOM, r0, c0);
  const b = tileRect(BASE_ZOOM, r1, c1);
  return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
})();
