/**
 * Deterministic city layout shared by the ground painter (roofs, yards, pools, shadows)
 * and the 3D buildings layer, so the two always line up.
 *
 * Every urban area is a street grid. Each grid cell becomes a block (split into parcels or
 * house lots), an avenue, a park, a parking lot, a plaza or highway verge.
 */

import {
  AIRPORT_ZONE,
  CAUSEWAYS,
  DOWNTOWN,
  HIGHWAYS,
  ROADS,
  URBAN_AREAS,
  onLand,
  pointInPolygon,
  type Pt,
  type UrbanArea,
} from "./geometry";
import { distToPolyline, samplePath } from "./paths";
import { rng } from "./noise";

export type BuildingStyle = "house" | "office" | "tower" | "glass" | "deco" | "warehouse" | "terminal";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Footprint extends Rect {
  /** Bottom and top elevation in map units (tiers of a tower stack on each other). */
  base: number;
  top: number;
  style: BuildingStyle;
  wall: string;
  roof: string;
  /** Rotation in degrees about the footprint centre. */
  rot?: number;
}

export interface Tree {
  x: number;
  y: number;
  r: number;
  palm: boolean;
}

export interface Lot extends Rect {
  yard: string;
  pool?: Rect;
  drive?: Rect;
}

export type CellKind = "block" | "avenue" | "park" | "parking" | "plaza" | "verge";

export interface Cell {
  x: number;
  y: number;
  size: number;
  inset: number;
  row: number;
  col: number;
  kind: CellKind;
  area: UrbanArea;
  avH: boolean;
  avV: boolean;
  seed: number;
  lots: Lot[];
  plazas: Rect[];
  pools: Rect[];
  trees: Tree[];
}

export interface CityPlan {
  cells: Cell[];
  footprints: Footprint[];
}

/* ---------------------------------------------------------------- palettes */

export const PALETTE = {
  officeWall: ["#e9e2d6", "#ddd3c4", "#f2ede4", "#cfc3b2", "#e5d5c1", "#d9d4cc"],
  officeRoof: ["#cdc8bf", "#bcb7ae", "#d8d4cc", "#a9a59d", "#c4bcae"],
  towerWall: ["#eeeae3", "#e0dbd2", "#f4f1ec", "#d6d0c6"],
  glassWall: ["#8fb3cf", "#9cc0d8", "#7ea5c4", "#a6c7d9", "#6f97b8"],
  towerRoof: ["#9b9da3", "#b3b1ac", "#8c8f96"],
  decoWall: ["#f7c6d4", "#bfe9dc", "#ffd9bb", "#dacff3", "#c3e1f6", "#fff0c4", "#f9d0e9"],
  decoRoof: ["#f1ece4", "#e6e0d6", "#ece7f0"],
  houseWall: ["#f3eee4", "#efe6d6", "#f6f1ea", "#e8e1d8", "#f4e4d4"],
  houseRoof: ["#c4704f", "#b8634a", "#d08a62", "#cfc9c0", "#e9e5dd", "#a9927a", "#8d939c", "#c79a76"],
  warehouseRoof: ["#a7adb3", "#8f979e", "#b9b4ab", "#9c8f86", "#7f8d97"],
  yard: ["#7f9a52", "#86a058", "#7a934e", "#8fa75e", "#94a35f"],
} as const;

const pick = <T,>(arr: readonly T[], t: number): T => arr[Math.min(arr.length - 1, Math.floor(t * arr.length))];

/* ------------------------------------------------------------------ helpers */

let roadLines: { line: Pt[]; clear: number }[] | null = null;
function roads() {
  roadLines ??= [
    ...HIGHWAYS.map((d) => ({ line: samplePath(d, 3), clear: 2.6 })),
    ...CAUSEWAYS.map((d) => ({ line: samplePath(d, 3), clear: 2.6 })),
    ...ROADS.map((d) => ({ line: samplePath(d, 3), clear: 1.2 })),
  ];
  return roadLines;
}

function nearRoad(p: Pt, cell: number): boolean {
  return roads().some(({ line, clear }) => distToPolyline(p, line) < cell * 0.5 + clear);
}

function shrink(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: Math.max(0.2, r.w - by * 2), h: Math.max(0.2, r.h - by * 2) };
}

/** Split a rect into parcels with a small gap between them. */
function split(r: Rect, rand: () => number, gap: number): Rect[] {
  const t = rand();
  if (t < 0.35) return [r];
  if (t < 0.72) {
    const ratio = 0.4 + rand() * 0.2;
    if (rand() < 0.5) {
      const w1 = (r.w - gap) * ratio;
      return [
        { x: r.x, y: r.y, w: w1, h: r.h },
        { x: r.x + w1 + gap, y: r.y, w: r.w - gap - w1, h: r.h },
      ];
    }
    const h1 = (r.h - gap) * ratio;
    return [
      { x: r.x, y: r.y, w: r.w, h: h1 },
      { x: r.x, y: r.y + h1 + gap, w: r.w, h: r.h - gap - h1 },
    ];
  }
  const w = (r.w - gap) / 2;
  const h = (r.h - gap) / 2;
  return [
    { x: r.x, y: r.y, w, h },
    { x: r.x + w + gap, y: r.y, w, h },
    { x: r.x, y: r.y + h + gap, w, h },
    { x: r.x + w + gap, y: r.y + h + gap, w, h },
  ];
}

function scatterTrees(r: Rect, n: number, rand: () => number, palms: number, out: Tree[], size = 1) {
  for (let i = 0; i < n; i++) {
    const palm = rand() < palms;
    const rad = (palm ? 0.45 + rand() * 0.25 : 0.5 + rand() * 0.5) * size;
    out.push({ x: r.x + rad + rand() * (r.w - rad * 2), y: r.y + rad + rand() * (r.h - rad * 2), r: rad, palm });
  }
}

/* ----------------------------------------------------------- block builders */

function towerTiers(p: Rect, height: number, rand: () => number, out: Footprint[]) {
  const glass = rand() < 0.55;
  const wall = glass ? pick(PALETTE.glassWall, rand()) : pick(PALETTE.towerWall, rand());
  const roof = pick(PALETTE.towerRoof, rand());
  const style: BuildingStyle = glass ? "glass" : "tower";
  const m = Math.min(p.w, p.h);
  const podium = Math.min(5, height * 0.12);
  out.push({ ...shrink(p, 0.15), base: 0, top: podium, style: "office", wall: pick(PALETTE.officeWall, rand()), roof: pick(PALETTE.officeRoof, rand()) });
  const shaft = shrink(p, m * (0.16 + rand() * 0.08));
  out.push({ ...shaft, base: 0, top: height, style, wall, roof });
  if (rand() < 0.55) {
    out.push({ ...shrink(p, m * 0.34), base: height, top: height * (1.04 + rand() * 0.05), style, wall, roof });
  }
}

function downtownBlock(cell: Cell, block: Rect, height: number, rand: () => number, out: Footprint[]) {
  const parcels = height > 30 ? [block] : split(block, rand, 0.45);
  for (const p of parcels) {
    cell.plazas.push(p);
    const h = parcels.length > 1 ? height * (0.65 + rand() * 0.6) : height;
    if (h > 30) {
      towerTiers(p, h, rand, out);
      scatterTrees(p, 2, rand, 0.7, cell.trees, 0.8);
      continue;
    }
    const b = shrink(p, 0.25 + rand() * 0.35);
    out.push({
      ...b,
      base: 0,
      top: Math.max(1.6, h),
      style: "office",
      wall: pick(PALETTE.officeWall, rand()),
      roof: pick(PALETTE.officeRoof, rand()),
    });
  }
}

function resortBlock(cell: Cell, block: Rect, height: number, rand: () => number, out: Footprint[]) {
  const parcels = split(block, rand, 0.4);
  for (const p of parcels) {
    cell.plazas.push(p);
    const h = parcels.length > 1 ? Math.max(2.5, height * (0.45 + rand() * 0.5)) : height;
    const wall = pick(PALETTE.decoWall, rand());
    const roof = pick(PALETTE.decoRoof, rand());
    // Leave the beach side of the parcel for a pool deck.
    const deck = Math.min(p.w * 0.35, 1.6);
    const b = shrink({ x: p.x, y: p.y, w: p.w - deck, h: p.h }, 0.22);
    if (h > 14) {
      out.push({ ...b, base: 0, top: Math.min(4, h * 0.2), style: "deco", wall, roof });
      out.push({ ...shrink(b, Math.min(b.w, b.h) * 0.14), base: 0, top: h, style: "deco", wall, roof });
    } else {
      out.push({ ...b, base: 0, top: h, style: "deco", wall, roof });
    }
    if (p.h > 2 && rand() < 0.8) {
      cell.pools.push({ x: p.x + p.w - deck + 0.2, y: p.y + p.h * 0.25, w: deck - 0.45, h: p.h * 0.45 });
    }
    scatterTrees({ x: p.x + p.w - deck, y: p.y, w: deck, h: p.h }, 2, rand, 1, cell.trees, 0.8);
  }
}

function houseBlock(cell: Cell, block: Rect, rand: () => number, out: Footprint[]) {
  const vertical = (cell.row + cell.col) % 2 === 0;
  const long = vertical ? block.h : block.w;
  const n = Math.max(2, Math.round(long / 2.7));
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const lot: Lot = vertical
        ? { x: block.x + (side * block.w) / 2, y: block.y + (i * block.h) / n, w: block.w / 2, h: block.h / n, yard: pick(PALETTE.yard, rand()) }
        : { x: block.x + (i * block.w) / n, y: block.y + (side * block.h) / 2, w: block.w / n, h: block.h / 2, yard: pick(PALETTE.yard, rand()) };
      cell.lots.push(lot);
      if (rand() < 0.06) {
        scatterTrees(lot, 2, rand, 0.3, cell.trees);
        continue; // empty lot
      }
      // Houses face the street; back yards (pools) face the block centre.
      const front = vertical ? (side === 0 ? "w" : "e") : side === 0 ? "n" : "s";
      const hw = (vertical ? lot.w * 0.5 : lot.w * 0.66) * (0.85 + rand() * 0.2);
      const hh = (vertical ? lot.h * 0.66 : lot.h * 0.5) * (0.85 + rand() * 0.2);
      const cx = lot.x + lot.w / 2;
      const cy = lot.y + lot.h / 2;
      let hx = cx - hw / 2;
      let hy = cy - hh / 2;
      const setback = 0.12;
      if (front === "w") hx = lot.x + lot.w * setback + 0.2;
      if (front === "e") hx = lot.x + lot.w * (1 - setback) - hw - 0.2;
      if (front === "n") hy = lot.y + lot.h * setback + 0.2;
      if (front === "s") hy = lot.y + lot.h * (1 - setback) - hh - 0.2;
      out.push({
        x: hx,
        y: hy,
        w: hw,
        h: hh,
        base: 0,
        top: 0.7 + rand() * (rand() < 0.3 ? 0.9 : 0.35),
        style: "house",
        wall: pick(PALETTE.houseWall, rand()),
        roof: pick(PALETTE.houseRoof, rand()),
      });
      // Driveway to the street.
      const dw = 0.45;
      if (front === "w") lot.drive = { x: lot.x, y: hy + hh - dw - 0.05, w: hx - lot.x, h: dw };
      if (front === "e") lot.drive = { x: hx + hw, y: hy + hh - dw - 0.05, w: lot.x + lot.w - hx - hw, h: dw };
      if (front === "n") lot.drive = { x: hx + hw - dw - 0.05, y: lot.y, w: dw, h: hy - lot.y };
      if (front === "s") lot.drive = { x: hx + hw - dw - 0.05, y: hy + hh, w: dw, h: lot.y + lot.h - hy - hh };
      // Back-yard pool (this is Leonida).
      if (rand() < 0.5) {
        const pw = vertical ? lot.w * 0.22 : lot.w * 0.4;
        const ph = vertical ? lot.h * 0.36 : lot.h * 0.2;
        let px = cx - pw / 2;
        let py = cy - ph / 2;
        if (front === "w") px = lot.x + lot.w - pw - 0.3;
        if (front === "e") px = lot.x + 0.3;
        if (front === "n") py = lot.y + lot.h - ph - 0.3;
        if (front === "s") py = lot.y + 0.3;
        lot.pool = { x: px, y: py, w: pw, h: ph };
      }
      scatterTrees(lot, rand() < 0.6 ? 1 : 2, rand, 0.35, cell.trees, 0.85);
    }
  }
}

function commercialBlock(cell: Cell, block: Rect, height: number, rand: () => number, out: Footprint[], port: boolean) {
  const parcels = split(block, rand, 0.5);
  for (const p of parcels) {
    cell.plazas.push(p);
    const warehouse = port && rand() < 0.6;
    const b = shrink(p, warehouse ? 0.3 : 0.35 + rand() * 0.4);
    out.push({
      ...b,
      base: 0,
      top: warehouse ? 1.2 + rand() * 0.8 : Math.max(1.2, height * (0.35 + rand() * 0.4)),
      style: warehouse ? "warehouse" : "office",
      wall: warehouse ? "#d6d2ca" : pick(PALETTE.officeWall, rand()),
      roof: warehouse ? pick(PALETTE.warehouseRoof, rand()) : pick(PALETTE.officeRoof, rand()),
    });
  }
}

function emptyCell(cell: Cell, block: Rect, rand: () => number) {
  const t = rand();
  const style = cell.area.style;
  if (style === "resort") {
    cell.kind = "plaza";
    cell.pools.push({ x: block.x + block.w * 0.2, y: block.y + block.h * 0.3, w: block.w * 0.45, h: block.h * 0.3 });
    scatterTrees(block, 6, rand, 1, cell.trees, 0.8);
    return;
  }
  if (style === "downtown") {
    cell.kind = t < 0.42 ? "park" : t < 0.85 ? "parking" : "plaza";
  } else {
    cell.kind = t < 0.6 ? "park" : "parking";
  }
  if (cell.kind === "park") scatterTrees(shrink(block, 0.3), 10 + Math.floor(rand() * 12), rand, 0.35, cell.trees);
  if (cell.kind === "plaza") scatterTrees(shrink(block, 0.6), 8, rand, 0.9, cell.trees, 0.8);
  if (cell.kind === "parking") {
    // Shade trees along the edge of the lot.
    for (let i = 0; i < 4; i++) {
      cell.trees.push({ x: block.x + 0.5 + (i * (block.w - 1)) / 3, y: block.y + 0.45, r: 0.45, palm: true });
    }
  }
}

function avenueCell(cell: Cell, rand: () => number) {
  // Palm-lined median down the middle of the boulevard.
  const { x, y, size } = cell;
  const step = 2.2;
  for (let s = step / 2; s < size; s += step) {
    if (cell.avV && !cell.avH) cell.trees.push({ x: x + size / 2, y: y + s, r: 0.5, palm: true });
    if (cell.avH && !cell.avV) cell.trees.push({ x: x + s, y: y + size / 2, r: 0.5, palm: true });
  }
  // Shade trees on the side verges.
  if (!(cell.avH && cell.avV)) {
    for (let i = 0; i < 4; i++) {
      const along = rand() * size;
      const off = rand() < 0.5 ? size * 0.12 : size * 0.88;
      cell.trees.push(cell.avV ? { x: x + off, y: y + along, r: 0.6, palm: false } : { x: x + along, y: y + off, r: 0.6, palm: false });
    }
  }
}

/* -------------------------------------------------------------------- plan */

function planArea(area: UrbanArea, cells: Cell[], footprints: Footprint[]) {
  const r = rng(area.seed);
  const xs = area.poly.map((p) => p[0]);
  const ys = area.poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const inset = area.cell * 0.17;
  let row = 0;
  for (let y = y0; y < y1; y += area.cell, row++) {
    let col = 0;
    for (let x = x0; x < x1; x += area.cell, col++) {
      const roll = r();
      const hRoll = r();
      r(); // keep the sequence stable for future per-cell draws
      const centre: Pt = [x + area.cell / 2, y + area.cell / 2];
      if (!pointInPolygon(centre, area.poly) || !onLand(centre)) continue;
      if (pointInPolygon(centre, AIRPORT_ZONE)) continue;

      const seed = area.seed * 100003 + row * 1009 + col * 7;
      const rand = rng(seed);
      const cell: Cell = {
        x,
        y,
        size: area.cell,
        inset,
        row,
        col,
        kind: "block",
        area,
        avH: row % 4 === 3,
        avV: col % 4 === 3,
        seed,
        lots: [],
        plazas: [],
        pools: [],
        trees: [],
      };
      cells.push(cell);
      const block: Rect = { x: x + inset, y: y + inset, w: area.cell - inset * 2, h: area.cell - inset * 2 };

      if (nearRoad(centre, area.cell)) {
        cell.kind = "verge";
        scatterTrees(block, 3 + Math.floor(rand() * 4), rand, 0.2, cell.trees);
        continue;
      }
      if (cell.avH || cell.avV) {
        cell.kind = "avenue";
        avenueCell(cell, rand);
        continue;
      }
      if (roll > area.density) {
        emptyCell(cell, block, rand);
        continue;
      }

      const [hMin, hMax] = area.height;
      let height = hMin + hRoll * (hMax - hMin);
      switch (area.style) {
        case "downtown": {
          const d = Math.hypot(centre[0] - DOWNTOWN.x, centre[1] - DOWNTOWN.y);
          if (d < DOWNTOWN.r) height += (1 - d / DOWNTOWN.r) * (25 + hRoll * 55);
          else if (hRoll > 0.95) height += 12;
          downtownBlock(cell, block, height, rand, footprints);
          break;
        }
        case "resort":
          resortBlock(cell, block, height, rand, footprints);
          break;
        case "residential":
          houseBlock(cell, block, rand, footprints);
          break;
        case "town":
          if (rand() < 0.55) houseBlock(cell, block, rand, footprints);
          else commercialBlock(cell, block, height, rand, footprints, area.id === "port-gellhorn");
          break;
      }
    }
  }
}

/** Airport buildings, placed in the rotated frame of the airport zone. */
function airportBuildings(out: Footprint[]) {
  const c = { x: 873, y: 1174 };
  const a = (-20 * Math.PI) / 180;
  const at = (u: number, v: number): Pt => [c.x + u * Math.cos(a) - v * Math.sin(a), c.y + u * Math.sin(a) + v * Math.cos(a)];
  const add = (u: number, v: number, w: number, h: number, top: number, style: BuildingStyle, wall: string, roof: string) => {
    const [x, y] = at(u, v);
    out.push({ x: x - w / 2, y: y - h / 2, w, h, base: 0, top, style, wall, roof, rot: -20 });
  };
  add(0, 23.5, 42, 4.5, 2.4, "terminal", "#e8e6e1", "#d9dde2");
  add(-6, 19.6, 3, 3.4, 1.6, "terminal", "#e8e6e1", "#c9ced4");
  add(8, 19.6, 3, 3.4, 1.6, "terminal", "#e8e6e1", "#c9ced4");
  add(27, 22, 1.6, 1.6, 8, "tower", "#eeeae3", "#8c8f96");
  add(-34, 22, 9, 6, 2, "warehouse", "#d6d2ca", "#9aa3ab");
  add(-44, 22, 7, 6, 1.8, "warehouse", "#d6d2ca", "#b9b4ab");
}

let cached: CityPlan | null = null;

export function cityPlan(): CityPlan {
  if (cached) return cached;
  const cells: Cell[] = [];
  const footprints: Footprint[] = [];
  for (const area of URBAN_AREAS) planArea(area, cells, footprints);
  airportBuildings(footprints);
  cached = { cells, footprints };
  return cached;
}
