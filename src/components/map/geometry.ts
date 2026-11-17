/**
 * Geometry for the Leonida map: a stylised outline of real-world Florida (public geography),
 * built from approximate latitude/longitude of well-known coastal points, islands, lakes and
 * rivers and projected into map-world units. Small detail (ponds, mangrove islets) is scattered
 * procedurally. Not traced from any game map.
 *
 * Units are map-world units: x grows east (0..MAP_WIDTH), y grows south (0..MAP_HEIGHT).
 * The texture is rendered for TEXTURE_AREA, which adds an ocean margin around the land.
 * One map unit is roughly 480 m on the ground.
 */

import type { RegionId } from "@/lib/types";

export type Pt = [number, number];
/** [latitude, longitude] in degrees. */
type LL = [number, number];

/* -------------------------------------------------------------- projection */

const LAT_TOP = 31.05;
const LON_LEFT = -83.95;
/** Map units per degree of latitude. */
const SCALE = 232;
const LON_SCALE = SCALE * Math.cos((27.6 * Math.PI) / 180);
const X_OFFSET = 150;

/** Latitude/longitude -> map units (simple equirectangular projection around 27.6° N). */
export function geo(lat: number, lon: number): Pt {
  return [Math.round(((lon - LON_LEFT) * LON_SCALE + X_OFFSET) * 10) / 10, Math.round((LAT_TOP - lat) * SCALE * 10) / 10];
}

const project = (pts: LL[]): Pt[] => pts.map(([lat, lon]) => geo(lat, lon));

/** Map units for a distance in degrees of latitude (handy for sizes). */
export const deg = (d: number) => d * SCALE;

export const TEXTURE_AREA = { x: 60, y: -40, w: 1080, h: 1660 };

/* ------------------------------------------------------------------ helpers */

/** Catmull-Rom spline through the points, as an SVG path. */
export function smoothPath(points: Pt[], closed = true, tension = 0.5): string {
  const n = points.length;
  const p = (i: number) => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${points[0][0]} ${points[0][1]}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const t = tension / 3;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return closed ? `${d} Z` : d;
}

export function polyPath(points: Pt[]): string {
  return `M${points.map((p) => p.join(" ")).join(" L")} Z`;
}

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Islet {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate: number;
}

export function inIslet([x, y]: Pt, e: Islet, scale = 1): boolean {
  const a = (-e.rotate * Math.PI) / 180;
  const dx = x - e.cx;
  const dy = y - e.cy;
  const u = dx * Math.cos(a) - dy * Math.sin(a);
  const v = dx * Math.sin(a) + dy * Math.cos(a);
  return (u / (e.rx * scale)) ** 2 + (v / (e.ry * scale)) ** 2 <= 1;
}

/** Deterministic PRNG so generated detail is identical on every load. */
export function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotated rectangle as a polygon. */
export function rectPoly(cx: number, cy: number, w: number, h: number, rotateDeg: number): Pt[] {
  const a = (rotateDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Pt);
}

/* -------------------------------------------------------------- shape tools */

/** Polygon with a clockwise (screen) winding, so overlapping shapes fill as a union. */
function cw(pts: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area >= 0 ? pts : [...pts].reverse();
}

function pt(lat: number, lon: number) {
  const [cx, cy] = geo(lat, lon);
  return { cx, cy };
}

/** Ellipse at a latitude/longitude; radii are in map units. */
const islet = (lat: number, lon: number, rx: number, ry = rx, rotate = 0): Islet => ({ ...pt(lat, lon), rx, ry, rotate });

/** Elongated islet spanning two latitude/longitude points. */
function isletBetween(a: LL, b: LL, width: number): Islet {
  const p = geo(...a);
  const q = geo(...b);
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  return {
    cx: (p[0] + q[0]) / 2,
    cy: (p[1] + q[1]) / 2,
    rx: Math.hypot(dx, dy) / 2 + width * 0.6,
    ry: width / 2,
    rotate: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** Natural-looking closed outline: an ellipse with a few low-frequency wobbles. */
function blob(lat: number, lon: number, rx: number, ry = rx, rotate = 0, wobble = 0.14): Pt[] {
  const [cx, cy] = geo(lat, lon);
  const r = seeded(Math.round(lat * 9173 + lon * 6311));
  const phase = [r() * 6.283, r() * 6.283, r() * 6.283];
  const a = (rotate * Math.PI) / 180;
  const n = Math.max(12, Math.min(28, Math.round((rx + ry) * 0.9)));
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 1 + wobble * Math.sin(2 * t + phase[0]) + wobble * 0.6 * Math.sin(3 * t + phase[1]) + wobble * 0.4 * Math.sin(5 * t + phase[2]);
    const u = Math.cos(t) * rx * k;
    const v = Math.sin(t) * ry * k;
    out.push([Math.round((cx + u * Math.cos(a) - v * Math.sin(a)) * 10) / 10, Math.round((cy + u * Math.sin(a) + v * Math.cos(a)) * 10) / 10]);
  }
  return out;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(pts: Pt[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Fast "is this point inside any of these polygons" test (bounding boxes first). */
function polyIndex(polys: Pt[][]) {
  const boxes = polys.map(boxOf);
  return ([x, y]: Pt) => {
    for (let i = 0; i < polys.length; i++) {
      const b = boxes[i];
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (pointInPolygon([x, y], polys[i])) return true;
    }
    return false;
  };
}

/** Fast "is this point inside any of these ellipses" test (grid buckets). */
function isletIndex(list: Islet[], cell = 24) {
  const grid = new Map<number, Islet[]>();
  const key = (gx: number, gy: number) => (gx + 64) * 4096 + (gy + 64);
  for (const e of list) {
    const r = Math.max(e.rx, e.ry);
    for (let gx = Math.floor((e.cx - r) / cell); gx <= Math.floor((e.cx + r) / cell); gx++) {
      for (let gy = Math.floor((e.cy - r) / cell); gy <= Math.floor((e.cy + r) / cell); gy++) {
        const k = key(gx, gy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(e);
        else grid.set(k, [e]);
      }
    }
  }
  return (p: Pt) => {
    const bucket = grid.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell)));
    return !!bucket && bucket.some((e) => inIslet(p, e));
  };
}

/* -------------------------------------------------------------- landmasses */

/**
 * Mainland outline, clockwise from the north-west, as named stretches of coast. Stretches
 * marked `beach` get a sand rim. The northern edge is a stylised coast (the real state
 * continues north), which turns the peninsula into an island.
 */
const COAST: { beach?: boolean; pts: LL[] }[] = [
  // Stylised north coast, west to east.
  { pts: [[29.98, -83.7], [30.24, -83.38], [30.4, -82.9], [30.47, -82.4], [30.56, -81.95], [30.68, -81.56], [30.72, -81.44]] },
  // Atlantic coast, north to south: sea islands, the cape, the long barrier beaches.
  {
    beach: true,
    pts: [
      [30.6, -81.44], [30.5, -81.43], [30.41, -81.4], [30.29, -81.39], [30.19, -81.37], [30.05, -81.33], [29.91, -81.285],
      [29.71, -81.225], [29.57, -81.165], [29.47, -81.12], [29.29, -81.035], [29.21, -81.0], [29.08, -80.92], [29.03, -80.89],
      [28.93, -80.82], [28.85, -80.765], [28.7, -80.66], [28.58, -80.575], [28.5, -80.535], [28.46, -80.525], [28.42, -80.575],
      [28.36, -80.6], [28.24, -80.6], [28.09, -80.565], [27.98, -80.52], [27.86, -80.445], [27.75, -80.39], [27.65, -80.355],
      [27.47, -80.285], [27.33, -80.225], [27.25, -80.19], [27.165, -80.155], [27.07, -80.115], [26.945, -80.07], [26.88, -80.05],
      [26.79, -80.03], [26.7, -80.03], [26.61, -80.035], [26.545, -80.04], [26.46, -80.055], [26.35, -80.068], [26.26, -80.08],
      [26.12, -80.1], [26.01, -80.115], [25.95, -80.118], [25.905, -80.12],
    ],
  },
  // Biscayne Bay shore (Ocean Beach is a separate barrier island).
  {
    pts: [
      [25.9, -80.15], [25.87, -80.165], [25.83, -80.18], [25.8, -80.186], [25.775, -80.186], [25.755, -80.192], [25.73, -80.225],
      [25.705, -80.25], [25.66, -80.265], [25.615, -80.305], [25.56, -80.31], [25.52, -80.335], [25.47, -80.335], [25.43, -80.325],
      [25.39, -80.335], [25.34, -80.34], [25.29, -80.375], [25.25, -80.415],
    ],
  },
  // Flora Bay shore, east to west.
  { pts: [[25.23, -80.46], [25.215, -80.53], [25.2, -80.6], [25.185, -80.66], [25.165, -80.73], [25.155, -80.8], [25.165, -80.86], [25.14, -80.925], [25.13, -81.0]] },
  // The south-west cape.
  { beach: true, pts: [[25.118, -81.08], [25.15, -81.143], [25.225, -81.172]] },
  // Mangrove coast up to the Ten Thousand Islands.
  { pts: [[25.29, -81.15], [25.35, -81.145], [25.42, -81.17], [25.52, -81.21], [25.6, -81.26], [25.7, -81.33], [25.78, -81.4], [25.84, -81.47], [25.87, -81.56], [25.845, -81.67]] },
  // South-west Gulf beaches.
  { beach: true, pts: [[25.9, -81.73], [25.96, -81.745], [26.05, -81.79], [26.14, -81.81], [26.26, -81.825], [26.33, -81.845], [26.4, -81.89], [26.455, -81.965]] },
  // Into the big harbour behind the barrier islands, and back out.
  {
    pts: [
      [26.485, -82.015], [26.535, -82.0], [26.56, -82.06], [26.63, -82.07], [26.7, -82.065], [26.76, -82.06], [26.83, -82.05],
      [26.9, -82.06], [26.935, -82.06], [26.95, -82.02], [26.975, -81.99], [26.985, -82.03], [26.965, -82.09], [26.945, -82.14],
      [26.96, -82.19], [27.0, -82.215], [26.96, -82.23], [26.9, -82.21], [26.83, -82.19], [26.785, -82.2], [26.8, -82.245],
      [26.83, -82.285],
    ],
  },
  // Gulf beaches up to the mouth of the bay.
  { beach: true, pts: [[26.87, -82.315], [26.93, -82.355], [27.0, -82.4], [27.1, -82.46], [27.2, -82.515], [27.27, -82.56], [27.33, -82.59], [27.39, -82.64], [27.47, -82.7], [27.535, -82.745]] },
  // Gellhorn Bay: south shore, the two upper bays around the middle peninsula, west shore.
  {
    pts: [
      [27.515, -82.69], [27.525, -82.64], [27.565, -82.61], [27.61, -82.575], [27.65, -82.555], [27.7, -82.5], [27.75, -82.45],
      [27.79, -82.415], [27.85, -82.395], [27.895, -82.41], [27.935, -82.435], [27.94, -82.46], [27.9, -82.485], [27.855, -82.49],
      [27.82, -82.515], [27.815, -82.54], [27.855, -82.555], [27.9, -82.545], [27.95, -82.55], [27.97, -82.58], [28.0, -82.6],
      [28.03, -82.645], [28.0, -82.69], [27.96, -82.71], [27.92, -82.69], [27.885, -82.645], [27.86, -82.61], [27.83, -82.6],
      [27.79, -82.625], [27.76, -82.625], [27.72, -82.63], [27.7, -82.655], [27.705, -82.69], [27.69, -82.72],
    ],
  },
  // Gulf beaches north of the bay.
  { beach: true, pts: [[27.685, -82.74], [27.73, -82.755], [27.77, -82.775], [27.82, -82.82], [27.88, -82.85], [27.94, -82.845], [27.98, -82.83], [28.04, -82.805], [28.1, -82.8], [28.17, -82.8]] },
  // Marsh coast of the big bend.
  {
    pts: [
      [28.25, -82.76], [28.36, -82.715], [28.48, -82.675], [28.56, -82.655], [28.7, -82.66], [28.78, -82.71], [28.9, -82.73],
      [29.0, -82.765], [29.1, -82.8], [29.15, -82.93], [29.14, -83.04], [29.22, -83.09], [29.29, -83.165], [29.37, -83.21],
      [29.44, -83.295], [29.55, -83.39], [29.67, -83.415], [29.75, -83.52], [29.82, -83.6],
    ],
  },
];

export const MAINLAND_PTS: Pt[] = project(COAST.flatMap((s) => s.pts));
export const MAINLAND = smoothPath(MAINLAND_PTS, true, 0.35);

/** Sandy stretches of the mainland coast (open paths that follow the outline). */
export const BEACH_PATHS: string[] = COAST.filter((s) => s.beach).map((s) => smoothPath(project(s.pts), false, 0.35));

/** Ocean Beach barrier island (drawn a little wider than life so the strip is readable). */
export const OCEAN_BEACH_PTS: Pt[] = project([
  [25.893, -80.118], [25.86, -80.116], [25.82, -80.118], [25.79, -80.123], [25.765, -80.127],
  [25.765, -80.146], [25.79, -80.145], [25.83, -80.142], [25.87, -80.142], [25.893, -80.136],
]);
export const OCEAN_BEACH_ISLAND = smoothPath(OCEAN_BEACH_PTS, true, 0.3);
/** The ocean side of the island, for its beach. */
export const OCEAN_BEACH_SHORE = smoothPath(OCEAN_BEACH_PTS.slice(0, 5), false, 0.3);

/** Larger islands with their own outlines. `sandy` ones get a beach all the way round. */
const ISLAND_SHAPES: { sandy?: boolean; pts: LL[] }[] = [
  // Bay islands off the city
  { sandy: true, pts: [[25.728, -80.158], [25.715, -80.148], [25.695, -80.15], [25.675, -80.153], [25.665, -80.158], [25.672, -80.168], [25.695, -80.172], [25.715, -80.17]] },
  { pts: [[25.752, -80.15], [25.745, -80.14], [25.732, -80.145], [25.73, -80.16], [25.742, -80.168]] },
  // Long outer key south of the bay
  { pts: [[25.515, -80.172], [25.5, -80.176], [25.46, -80.188], [25.42, -80.203], [25.403, -80.214], [25.41, -80.224], [25.44, -80.208], [25.48, -80.196], [25.513, -80.183]] },
  // Shell island at the harbour mouth
  { sandy: true, pts: [[26.452, -82.012], [26.435, -82.03], [26.422, -82.07], [26.425, -82.11], [26.445, -82.15], [26.475, -82.18], [26.49, -82.185], [26.485, -82.165], [26.465, -82.13], [26.455, -82.09], [26.465, -82.05], [26.47, -82.025]] },
  // Long island inside the harbour
  { pts: [[26.705, -82.155], [26.66, -82.138], [26.6, -82.122], [26.54, -82.102], [26.495, -82.083], [26.488, -82.1], [26.53, -82.127], [26.6, -82.152], [26.66, -82.168], [26.7, -82.172]] },
];
export const LAND_POLYS: Pt[][] = ISLAND_SHAPES.map((s) => cw(project(s.pts)));
export const SANDY_POLYS: Pt[][] = ISLAND_SHAPES.filter((s) => s.sandy).map((s) => cw(project(s.pts)));

/** Barrier islands and other named islets (sandy: beach all the way round). */
export const BARRIER_ISLANDS: Islet[] = [
  // Outer islands of the big harbour, south to north
  isletBetween([26.5, -82.19], [26.55, -82.2], 1.5),
  isletBetween([26.57, -82.21], [26.62, -82.225], 1.5),
  isletBetween([26.635, -82.235], [26.705, -82.255], 2.2),
  isletBetween([26.722, -82.262], [26.805, -82.275], 1.7),
  // Mouth of Gellhorn Bay
  islet(27.59, -82.762, 0.8, 2.2, 5),
  islet(27.625, -82.715, 4.6, 1.5, -22),
  islet(27.67, -82.725, 1.4, 1.8),
  // Gulf islands north of the bay
  islet(28.03, -82.826, 0.8, 2.6, 4),
  islet(28.075, -82.832, 0.8, 2.6, -4),
  islet(28.19, -82.846, 0.6, 2.6),
];

/** Small islands that are not beaches: bay islands, harbour islets, the cedar keys. */
const MINOR_ISLANDS: Islet[] = [
  // Port island and the causeway islands in the bay between downtown and Ocean Beach
  islet(25.775, -80.166, 3.4, 0.75, -6),
  islet(25.786, -80.177, 0.8),
  islet(25.791, -80.169, 0.55), islet(25.791, -80.162, 0.55), islet(25.791, -80.155, 0.55), islet(25.791, -80.149, 0.5),
  islet(25.78, -80.158, 1.5, 0.4), islet(25.777, -80.15, 0.55, 0.4),
  islet(25.762, -80.142, 0.9, 0.7),
  islet(25.847, -80.153, 0.75), islet(25.847, -80.16, 0.6),
  islet(25.812, -80.165, 0.6, 0.4), islet(25.868, -80.152, 0.5),
  // Keys south of the long outer key
  islet(25.527, -80.174, 0.5), islet(25.59, -80.162, 0.4), islet(25.395, -80.236, 0.9, 1.2), islet(25.375, -80.243, 1.2, 1.8, 20), islet(25.385, -80.262, 0.8, 1.4, 20),
  // Islets in the big harbour sound
  islet(26.66, -82.212, 0.6), islet(26.655, -82.228, 0.5), islet(26.59, -82.19, 0.7), islet(26.56, -82.17, 0.5), islet(26.63, -82.105, 0.5), islet(26.47, -82.045, 0.5),
  islet(26.82, -82.225, 0.7), islet(26.86, -82.14, 0.6),
  // The cedar keys
  islet(29.12, -83.06, 1), islet(29.1, -83.075, 0.7), islet(29.105, -83.03, 0.8), islet(29.155, -83.075, 0.7), islet(29.165, -83.02, 0.6),
  // Far western keys: an atoll ring and the fort islands
  islet(24.585, -82.11, 1.3, 0.6, 20), islet(24.565, -82.095, 0.6, 1.3), islet(24.555, -82.12, 1.4, 0.5), islet(24.57, -82.15, 0.6, 1.4, -10), islet(24.59, -82.14, 0.8, 0.5),
  islet(24.628, -82.873, 0.7), islet(24.627, -82.862, 0.6, 0.4), islet(24.635, -82.92, 0.45, 1.4),
  islet(24.6, -81.98, 0.6), islet(24.585, -81.92, 0.7, 0.5),
];

const inMainland = (p: Pt) => pointInPolygon(p, MAINLAND_PTS);

function coastDistance([x, y]: Pt): number {
  let best = Infinity;
  const n = MAINLAND_PTS.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = MAINLAND_PTS[i];
    const [bx, by] = MAINLAND_PTS[(i + 1) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (d < best) best = d;
  }
  return best;
}

/** Rough latitude of the Keys chain at a longitude (to keep bay islets on the bay side). */
function keysLat(lon: number): number {
  const line: LL[] = [[25.3, -80.3], [25.185, -80.39], [25.02, -80.5], [24.92, -80.63], [24.815, -80.82], [24.72, -81.05], [24.66, -81.28], [24.65, -81.55], [24.555, -81.8]];
  for (let i = 1; i < line.length; i++) {
    if (lon >= line[i][1]) {
      const [la0, lo0] = line[i - 1];
      const [la1, lo1] = line[i];
      return la0 + ((lon - lo0) / (lo1 - lo0)) * (la1 - la0);
    }
  }
  return line[line.length - 1][0];
}

/** Scatter tiny islets in open water inside a latitude/longitude box. */
function scatterIslets(
  seed: number,
  count: number,
  [latS, lonW, latN, lonE]: [number, number, number, number],
  [rMin, rMax]: [number, number],
  keep: (p: Pt, lat: number, lon: number) => boolean,
): Islet[] {
  const r = seeded(seed);
  const out: Islet[] = [];
  for (let i = 0; i < count * 6 && out.length < count; i++) {
    const lat = latS + r() * (latN - latS);
    const lon = lonW + r() * (lonE - lonW);
    const size = rMin + r() * r() * (rMax - rMin);
    const stretch = 0.55 + r() * 0.45;
    const rotate = r() * 180;
    const p = geo(lat, lon);
    if (inMainland(p) || !keep(p, lat, lon)) continue;
    out.push({ cx: p[0], cy: p[1], rx: size, ry: size * stretch, rotate });
  }
  return out;
}

/** Mangrove islets: the Ten Thousand Islands, Flora Bay, the back-country keys, the marsh coast. */
export const BAY_ISLANDS: Islet[] = [
  ...scatterIslets(1010, 150, [25.55, -81.75, 25.95, -81.2], [0.5, 2], (p) => coastDistance(p) < 9),
  ...scatterIslets(1011, 30, [25.15, -81.2, 25.55, -81.1], [0.5, 1.4], (p) => coastDistance(p) < 3.5),
  ...scatterIslets(1012, 70, [24.9, -81.05, 25.2, -80.42], [0.5, 2.2], (p, lat, lon) => lat > keysLat(lon) + 0.035 && coastDistance(p) > 2),
  ...scatterIslets(1013, 70, [24.64, -81.82, 24.9, -81.15], [0.5, 2], (_p, lat, lon) => lat > keysLat(lon) + 0.045),
  ...scatterIslets(1014, 70, [28.45, -82.9, 29.3, -82.62], [0.4, 1.3], (p) => coastDistance(p) < 4.5),
  ...scatterIslets(1015, 26, [29.3, -83.7, 29.9, -83.15], [0.4, 1.1], (p) => coastDistance(p) < 3),
  ...scatterIslets(1016, 14, [25.24, -80.42, 25.5, -80.22], [0.4, 1], (p) => coastDistance(p) < 5 && coastDistance(p) > 1),
];

/** The Keys chain, from the big upper key down to the last town and beyond. */
const KEY_SHAPES: Islet[] = [
  // Upper keys: long thin islands end to end
  isletBetween([25.32, -80.275], [25.2, -80.345], 3.6),
  isletBetween([25.19, -80.355], [25.085, -80.44], 3.2),
  islet(25.17, -80.377, 3.2, 2.4, -30),
  isletBetween([25.07, -80.455], [25.02, -80.5], 2.2),
  isletBetween([25.01, -80.515], [24.97, -80.56], 2),
  isletBetween([24.955, -80.585], [24.948, -80.6], 1.5),
  isletBetween([24.935, -80.615], [24.905, -80.65], 1.6),
  islet(24.9, -80.7, 1), islet(24.917, -80.74, 0.7),
  isletBetween([24.87, -80.69], [24.85, -80.725], 1.3),
  islet(24.84, -80.77, 0.6),
  isletBetween([24.825, -80.8], [24.805, -80.845], 1.6),
  islet(24.79, -80.885, 0.6),
  islet(24.775, -80.915, 1.1),
  // Middle keys
  isletBetween([24.77, -80.94], [24.755, -80.975], 1.5),
  isletBetween([24.745, -80.99], [24.73, -81.02], 1.8),
  isletBetween([24.725, -81.03], [24.705, -81.11], 3.4),
  islet(24.695, -81.09, 2, 0.8, 10),
  islet(24.704, -81.155, 0.4),
  // West of the long bridge: islands that run north-south
  islet(24.682, -81.23, 0.55), islet(24.676, -81.24, 0.5), islet(24.672, -81.249, 0.5),
  isletBetween([24.665, -81.262], [24.655, -81.285], 1.2),
  islet(24.652, -81.305, 0.7),
  islet(24.685, -81.365, 3.2, 9.5, 6),
  islet(24.697, -81.325, 2, 2.3),
  islet(24.675, -81.39, 0.9, 4.5, 4), islet(24.69, -81.405, 0.7, 4.5, 4), islet(24.71, -81.43, 1, 5, 4),
  islet(24.662, -81.413, 1, 3), islet(24.662, -81.445, 1.2, 3.2),
  islet(24.67, -81.495, 2.6, 4.6, -8),
  islet(24.655, -81.55, 3.8, 3.2), islet(24.685, -81.525, 1.4, 3, -20),
  islet(24.625, -81.6, 1.6, 2.1), islet(24.613, -81.627, 1.3, 1.4),
  islet(24.598, -81.66, 2.3, 1.1),
  islet(24.577, -81.692, 3.4, 1.8, -8),
  islet(24.57, -81.735, 1.7, 1.5),
  islet(24.555, -81.785, 5.6, 2.8, -12),
  islet(24.567, -81.813, 0.5),
];
/** Drawn a little fatter than life so the chain reads at whole-map zoom. */
export const KEYS: Islet[] = KEY_SHAPES.map((e) =>
  e.rx >= e.ry ? { ...e, rx: e.rx * 1.08, ry: e.ry * 1.45 } : { ...e, rx: e.rx * 1.45, ry: e.ry * 1.08 },
);

const ISLETS: Islet[] = [...BARRIER_ISLANDS, ...MINOR_ISLANDS, ...BAY_ISLANDS, ...KEYS];
/** Every ellipse-shaped island on the map. */
export const ALL_ISLETS = ISLETS;

/* ------------------------------------------------------------- inland water */

/** Lake Leonida: the big shallow lake in the middle of the south. */
const BIG_LAKE: Pt[] = project([
  [27.2, -80.83], [27.17, -80.74], [27.12, -80.67], [27.05, -80.63], [26.98, -80.61], [26.9, -80.62], [26.82, -80.655],
  [26.74, -80.69], [26.69, -80.72], [26.685, -80.78], [26.72, -80.86], [26.76, -80.92], [26.8, -81.0], [26.84, -81.08],
  [26.9, -81.11], [26.97, -81.12], [27.02, -81.07], [27.08, -81.02], [27.13, -80.94], [27.17, -80.88],
]);

/** Named lakes: [lat, lon, rx, ry, rotate]; radii in map units, real sizes. */
const LAKE_LIST: [number, number, number, number, number][] = [
  // Chain of lakes down the middle
  [27.9, -81.27, 8, 19, 12], [28.2, -81.38, 5, 13, -18], [28.29, -81.28, 8, 7.5, 0], [28.08, -81.33, 4.6, 4.2, 0],
  [28.02, -81.4, 7, 4, 20], [27.38, -81.28, 10.5, 13.5, 0], [27.8, -81.42, 5, 8, 0], [27.93, -81.4, 3.6, 3.2, 0],
  [27.89, -81.36, 2.4, 2.4, 0], [27.88, -81.1, 3.5, 8, 15], [27.7, -81.4, 2.4, 5, 0], [27.97, -81.52, 3.4, 3.8, 0],
  [27.8, -81.58, 3, 5, 10], [27.25, -81.37, 3.5, 3.2, 0], [27.3, -81.41, 2.6, 2.6, 0], [27.49, -81.46, 3.4, 3.4, 0],
  [27.6, -81.5, 2.2, 2.6, 0], [27.21, -81.33, 2, 2.4, 0], [27.73, -80.75, 4.5, 7.5, 0],
  // The lake country north-west of the theme-park city
  [28.62, -81.62, 13, 12, 0], [28.78, -81.83, 8, 7, 0], [28.86, -81.85, 3.4, 9.5, 5], [28.845, -81.73, 6.4, 6, 0],
  [28.79, -81.69, 6, 2.8, -15], [28.91, -81.74, 4.4, 4.2, 0], [28.48, -81.74, 3.6, 3.6, 0], [28.55, -81.76, 2.5, 2.3, 0],
  [28.52, -81.72, 2.2, 2.2, 0], [28.48, -81.55, 3.4, 3.8, 0], [28.47, -81.35, 2.8, 3.2, 0], [28.38, -81.22, 2.8, 2.6, 0],
  [28.4, -81.17, 2, 2.2, 0], [28.6, -81.35, 1.4, 1.6, 0], [28.57, -81.44, 1.3, 1.2, 0],
  // Lakes along the long north-flowing river
  [29.28, -81.6, 10, 18.5, 0], [29.45, -81.5, 4.5, 16, -14], [28.83, -81.27, 9, 5.5, 0], [28.72, -81.22, 10, 4, 8],
  [28.76, -81.06, 5.6, 5.6, 0], [28.34, -80.83, 4, 3.8, 0], [28.15, -80.74, 2.5, 5, 0], [28.25, -80.83, 2.4, 3, 0],
  [29.19, -81.5, 2.6, 2.4, 0], [29.02, -81.42, 2.6, 2.2, 0], [29.5, -81.82, 7, 1.6, -20],
  // North-central lakes
  [29.46, -82.18, 9, 7, 0], [29.52, -82.13, 5.5, 5, 0], [29.65, -82.22, 6, 5.6, 0], [29.74, -82.07, 4.6, 4.2, 0],
  [29.96, -81.99, 2.5, 2.5, 0], [29.02, -81.94, 4.5, 4.2, 0], [29.35, -81.78, 3, 2.6, 0], [29.78, -82.0, 2.2, 2.6, 0],
  [29.6, -82.05, 2, 2.2, 0], [30.02, -82.1, 2, 2.4, 0], [30.2, -82.4, 2.6, 2.2, 0],
  // West side
  [28.8, -82.12, 2, 6, -10], [28.85, -82.3, 3.4, 10, -6], [27.97, -81.84, 4, 4.4, 0], [28.07, -81.93, 2.5, 2.4, 0],
  [28.02, -81.73, 1.8, 1.8, 0], [28.0, -81.69, 1.6, 1.8, 0], [28.045, -81.7, 1.4, 1.4, 0], [28.05, -81.65, 2.4, 2.6, 0],
  [28.08, -81.53, 3, 3.2, 0], [28.14, -81.72, 1.8, 1.8, 0], [27.9, -81.63, 1.8, 2.2, 0], [28.1, -82.58, 2.2, 2.6, 0],
  [28.4, -82.18, 2.6, 2.4, 0],
  // South-west
  [26.42, -81.5, 2.6, 2.4, 0],
  // Tidal bay inside the south-west cape
  [25.29, -80.99, 15, 5.5, -32], [25.38, -81.07, 5, 3.4, -20], [25.2, -80.88, 4, 2.6, -20],
];

export const LAKE_POLYS: Pt[][] = [cw(BIG_LAKE), ...LAKE_LIST.map(([lat, lon, rx, ry, rot]) => cw(blob(lat, lon, rx, ry, rot)))];
const inLake = polyIndex(LAKE_POLYS);

/** Thousands of small lakes and ponds dot the peninsula: scatter them by zone. */
export const PONDS: Islet[] = (() => {
  const zones: [number, number, [number, number, number, number], [number, number]][] = [
    // seed, count, [latS, lonW, latN, lonE], [rMin, rMax]
    [2001, 300, [27.2, -81.98, 28.98, -81.22], [0.45, 2.3]],
    [2002, 90, [28.28, -81.62, 28.82, -81.12], [0.45, 1.5]],
    [2003, 110, [29.28, -82.38, 29.98, -81.62], [0.45, 2]],
    [2004, 80, [28.02, -82.72, 28.4, -82.28], [0.4, 1.5]],
    [2005, 150, [25.58, -80.47, 26.78, -80.19], [0.4, 1.3]],
    [2006, 80, [26.02, -81.92, 26.78, -81.58], [0.4, 1.3]],
    [2007, 60, [27.0, -82.55, 27.6, -82.25], [0.4, 1.2]],
    [2008, 220, [25.4, -83.5, 30.62, -80.1], [0.4, 1.6]],
    [2009, 50, [30.0, -82.3, 30.5, -81.5], [0.4, 1.3]],
  ];
  const out: Islet[] = [];
  for (const [seed, count, [latS, lonW, latN, lonE], [rMin, rMax]] of zones) {
    const r = seeded(seed);
    for (let i = 0; i < count; i++) {
      const lat = latS + r() * (latN - latS);
      const lon = lonW + r() * (lonE - lonW);
      const size = rMin + r() * r() * r() * (rMax - rMin);
      const stretch = 0.6 + r() * 0.4;
      const rotate = r() * 180;
      const p = geo(lat, lon);
      if (!inMainland(p) || coastDistance(p) < 2.5 || inLake(p)) continue;
      out.push({ cx: p[0], cy: p[1], rx: size, ry: size * stretch, rotate });
    }
  }
  return out;
})();
const inPond = isletIndex(PONDS);

/** Rivers, lagoons and canals, drawn as water strokes of a given width (map units). */
export interface Waterway {
  d: string;
  width: number;
}

const water = (width: number, pts: LL[]): Waterway => ({ d: smoothPath(project(pts), false), width });
const canal = (pts: LL[]): Waterway => ({ d: `M${project(pts).map((p) => p.join(" ")).join(" L")}`, width: 0.45 });

export const WATERWAYS: Waterway[] = [
  // The long north-flowing river: broad estuary, then narrowing upstream through its lakes
  water(2.4, [[30.4, -81.4], [30.385, -81.5], [30.39, -81.58], [30.325, -81.655]]),
  water(5.5, [[30.325, -81.655], [30.25, -81.68], [30.15, -81.69], [30.05, -81.685], [29.95, -81.63], [29.86, -81.58]]),
  water(3.4, [[29.86, -81.58], [29.75, -81.57], [29.65, -81.63]]),
  water(1.5, [[29.65, -81.63], [29.55, -81.68], [29.46, -81.67], [29.38, -81.62], [29.16, -81.53], [29.02, -81.42], [28.88, -81.32], [28.83, -81.27]]),
  water(1.1, [[28.83, -81.2], [28.76, -81.06], [28.62, -80.97], [28.45, -80.9], [28.34, -80.83], [28.25, -80.83], [28.15, -80.74], [27.95, -80.76], [27.8, -80.76]]),
  // Sea-island creeks in the north-east
  water(1.1, [[30.71, -81.47], [30.6, -81.475], [30.5, -81.46], [30.42, -81.44]]),
  water(1, [[30.52, -81.45], [30.56, -81.53], [30.58, -81.62]]),
  water(1, [[30.25, -81.42], [30.1, -81.385], [29.95, -81.32], [29.8, -81.27], [29.7, -81.24]]),
  // Lagoons behind the Atlantic barrier beaches
  water(1.3, [[29.4, -81.1], [29.3, -81.06], [29.2, -81.018], [29.1, -80.95]]),
  water(3.2, [[29.02, -80.9], [28.93, -80.85], [28.83, -80.79], [28.74, -80.74]]),
  water(3.4, [[28.78, -80.84], [28.62, -80.79], [28.45, -80.74], [28.3, -80.7]]),
  water(2.6, [[28.3, -80.7], [28.15, -80.65], [28.02, -80.59], [27.86, -80.49], [27.66, -80.39], [27.5, -80.33]]),
  water(1.9, [[27.5, -80.33], [27.38, -80.27], [27.27, -80.22], [27.18, -80.18]]),
  water(2.4, [[28.57, -80.62], [28.45, -80.64], [28.32, -80.64], [28.2, -80.628], [28.14, -80.61]]),
  water(1.3, [[27.08, -80.135], [27.0, -80.1], [26.95, -80.085]]),
  water(1.3, [[26.86, -80.06], [26.78, -80.048], [26.68, -80.046], [26.57, -80.048]]),
  water(0.7, [[26.5, -80.062], [26.35, -80.078], [26.2, -80.1], [26.1, -80.112], [25.95, -80.128]]),
  // East-coast rivers
  water(1.9, [[27.165, -80.17], [27.19, -80.22], [27.2, -80.26], [27.25, -80.3]]),
  water(1, [[27.2, -80.26], [27.14, -80.27], [27.1, -80.3]]),
  water(1.2, [[26.945, -80.08], [26.95, -80.11], [26.97, -80.15]]),
  water(0.7, [[26.115, -80.105], [26.12, -80.15], [26.1, -80.2]]),
  water(0.6, [[25.77, -80.19], [25.785, -80.23], [25.81, -80.27], [25.83, -80.3]]),
  // The middle river into the big lake, and the lake's other feeders and outlets
  water(1, [[28.1, -81.34], [28.02, -81.4]]),
  water(1.1, [[27.74, -81.2], [27.6, -81.14], [27.45, -81.07], [27.3, -80.97], [27.2, -80.9], [27.16, -80.87]]),
  water(0.6, [[27.05, -81.4], [26.98, -81.28], [26.96, -81.14]]),
  water(0.7, [[27.37, -81.18], [27.3, -81.05]]),
  canal([[26.985, -80.615], [27.02, -80.45], [27.1, -80.3], [27.17, -80.265]]),
  // South-west river: broad at the mouth, a canal upstream
  water(3.2, [[26.5, -82.01], [26.535, -81.96], [26.59, -81.905], [26.65, -81.87], [26.7, -81.82]]),
  water(1, [[26.7, -81.82], [26.72, -81.7], [26.74, -81.55], [26.76, -81.44], [26.79, -81.3], [26.84, -81.1]]),
  // Rivers into the big harbour and Gellhorn Bay
  water(1.6, [[26.975, -81.99], [27.0, -81.985], [27.03, -81.99]]),
  water(0.9, [[27.03, -81.99], [27.2, -81.88], [27.5, -81.81], [27.75, -81.79], [27.95, -81.82]]),
  water(0.8, [[27.0, -82.215], [27.06, -82.28], [27.2, -82.33], [27.35, -82.28]]),
  water(2, [[27.522, -82.65], [27.512, -82.59], [27.5, -82.53]]),
  water(1, [[27.5, -82.53], [27.5, -82.45], [27.47, -82.36]]),
  water(0.8, [[27.715, -82.48], [27.68, -82.4], [27.67, -82.3]]),
  water(0.8, [[27.855, -82.395], [27.86, -82.3], [27.88, -82.2]]),
  water(0.8, [[27.945, -82.46], [28.0, -82.465], [28.03, -82.42], [28.08, -82.37], [28.15, -82.25]]),
  // Lagoon behind the long Gulf keys
  water(3.6, [[27.46, -82.675], [27.4, -82.615], [27.34, -82.57]]),
  water(1.2, [[27.34, -82.57], [27.25, -82.535], [27.15, -82.48]]),
  water(1, [[26.99, -82.385], [26.92, -82.34], [26.87, -82.305]]),
  water(1.6, [[26.42, -81.89], [26.38, -81.855], [26.34, -81.84]]),
  water(1.2, [[25.93, -81.72], [25.98, -81.72], [26.03, -81.75]]),
  // Spring rivers and the western rivers
  water(1, [[28.9, -82.59], [28.905, -82.66], [28.92, -82.72]]),
  water(0.8, [[28.8, -82.58], [28.79, -82.65], [28.78, -82.7]]),
  water(0.9, [[28.3, -82.05], [28.5, -82.2], [28.75, -82.3], [28.98, -82.4], [29.02, -82.6], [29.0, -82.76]]),
  water(1, [[28.95, -81.87], [29.08, -81.95], [29.22, -81.98], [29.36, -81.9], [29.48, -81.85], [29.5, -81.72], [29.48, -81.68]]),
  water(1.2, [[30.4, -83.16], [30.25, -83.22], [30.1, -83.0], [29.95, -82.93], [29.75, -82.94], [29.58, -82.95], [29.42, -83.08], [29.3, -83.16]]),
  water(0.8, [[29.84, -82.2], [29.92, -82.45], [29.84, -82.65], [29.88, -82.88]]),
  water(0.7, [[29.67, -83.37], [29.75, -83.3], [29.85, -83.25]]),
  water(0.7, [[29.15, -82.8], [29.22, -82.72], [29.32, -82.68]]),
  // Tidal rivers of the mangrove coast
  water(1, [[25.35, -81.145], [25.38, -81.05], [25.44, -80.97], [25.5, -80.9]]),
  water(0.9, [[25.42, -81.17], [25.47, -81.08], [25.5, -81.0]]),
  water(0.9, [[25.55, -81.215], [25.57, -81.13], [25.6, -81.05]]),
  water(0.9, [[25.7, -81.33], [25.72, -81.25], [25.76, -81.18]]),
  water(0.8, [[25.84, -81.47], [25.87, -81.38], [25.9, -81.3]]),
  water(0.8, [[25.3, -81.03], [25.32, -80.95], [25.36, -80.9]]),
  // Drainage canals fanning out from the big lake across the south
  canal([[26.86, -80.63], [26.76, -80.5], [26.68, -80.37], [26.68, -80.06]]),
  canal([[26.7, -80.71], [26.47, -80.45], [26.36, -80.3], [26.33, -80.1]]),
  canal([[26.69, -80.72], [26.33, -80.54], [26.13, -80.44], [26.1, -80.2]]),
  canal([[26.76, -80.92], [26.4, -80.75], [26.05, -80.5], [25.87, -80.35], [25.83, -80.3]]),
  canal([[25.762, -80.3], [25.762, -80.85], [25.86, -81.2], [25.9, -81.35]]),
  canal([[26.33, -80.54], [25.95, -80.6], [25.762, -80.68]]),
  canal([[26.15, -80.45], [26.15, -81.6]]),
  canal([[26.15, -80.88], [25.8, -80.84]]),
  canal([[25.762, -80.5], [25.55, -80.56], [25.4, -80.57], [25.3, -80.44]]),
  canal([[26.34, -80.3], [26.34, -80.45], [26.15, -80.45], [25.95, -80.44]]),
  canal([[26.6, -80.36], [26.48, -80.22], [26.47, -80.07]]),
  canal([[26.23, -80.3], [26.23, -80.1]]),
  canal([[25.95, -80.44], [25.94, -80.15]]),
  canal([[25.65, -80.48], [25.61, -80.31]]),
  canal([[26.42, -81.5], [26.3, -81.6], [26.17, -81.7]]),
];

/* ------------------------------------------------------------------ land use */

/** Pine forests of the north and the central scrub (Mount Kalaga). */
export const FORESTS: Pt[][] = [
  project([[30.2, -83.4], [30.45, -82.6], [30.45, -82.0], [29.9, -81.9], [29.6, -82.6], [29.5, -83.1]]),
  project([[29.45, -81.95], [29.45, -81.55], [28.95, -81.55], [28.95, -81.95]]),
  project([[28.95, -82.55], [29.3, -82.4], [29.3, -82.05], [28.75, -82.1], [28.55, -82.4]]),
  project([[28.52, -82.08], [28.52, -81.78], [28.22, -81.78], [28.22, -82.08]]),
  project([[30.5, -81.9], [30.45, -81.6], [30.1, -81.75], [30.05, -82.0]]),
  project([[29.75, -81.5], [29.75, -81.3], [29.35, -81.2], [29.3, -81.4]]),
  project([[27.75, -81.2], [27.75, -80.95], [27.4, -80.9], [27.4, -81.12]]),
];

/** Citrus, cattle and the sugar fields south of the lake (Ambrosia). */
export const FARMS: Pt[][] = [
  project([[26.78, -80.97], [26.72, -80.6], [26.62, -80.45], [26.35, -80.45], [26.35, -80.95]]),
  project([[28.3, -81.95], [28.3, -81.7], [27.6, -81.35], [27.15, -81.3], [27.0, -81.75], [27.2, -82.05], [27.8, -82.1]]),
  project([[27.75, -80.95], [27.75, -80.55], [27.3, -80.5], [27.2, -80.95]]),
  project([[26.95, -81.6], [26.95, -81.15], [26.55, -81.2], [26.5, -81.6]]),
  project([[25.6, -80.56], [25.6, -80.42], [25.42, -80.42], [25.4, -80.56]]),
];

/** The sawgrass marshes and cypress swamps of the south (Grassrivers), and river marshes. */
export const WETLANDS: Pt[][] = [
  project([[26.35, -80.95], [26.35, -80.45], [25.9, -80.45], [25.5, -80.5], [25.2, -80.6], [25.15, -81.05], [25.4, -81.12], [25.9, -81.0]]),
  project([[26.45, -81.55], [26.4, -80.95], [25.9, -80.95], [25.8, -81.45]]),
  project([[27.95, -81.2], [27.95, -80.95], [27.35, -80.85], [27.35, -81.15]]),
  project([[28.6, -80.98], [28.6, -80.84], [27.6, -80.66], [27.6, -80.86]]),
  project([[29.9, -83.6], [29.2, -83.0], [28.5, -82.6], [28.5, -82.75], [29.1, -83.15], [29.8, -83.7]]),
];

/* -------------------------------------------------------------- urban areas */

export type UrbanStyle = "downtown" | "residential" | "resort" | "town";

export interface UrbanArea {
  id: string;
  /** What the blocks are filled with: towers, houses, beach hotels, or a mix. */
  style: UrbanStyle;
  poly: Pt[];
  cell: number;
  density: number;
  /** Building height range in map units for the 3D layer. */
  height: [number, number];
  seed: number;
  /** Street spacing for the 2D road map, in map units. */
  street: number;
}

export const DOWNTOWN = (() => {
  const [x, y] = geo(25.775, -80.195);
  return { x, y, r: 7 };
})();

function town(id: string, lat: number, lon: number, rLat: number, rLon: number, seed: number, style: UrbanStyle = "town"): UrbanArea {
  const r = seeded(seed);
  const pts: LL[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.75 + r() * 0.45;
    pts.push([lat + Math.sin(a) * rLat * k, lon + Math.cos(a) * rLon * k]);
  }
  return { id, style, poly: project(pts), cell: 6, density: 0.6, height: [2, 6], seed, street: 1.6 };
}

export const URBAN_AREAS: UrbanArea[] = [
  {
    id: "vice-city",
    style: "downtown",
    poly: project([
      [26.12, -80.11], [26.12, -80.42], [25.98, -80.45], [25.75, -80.47], [25.6, -80.44], [25.47, -80.5], [25.43, -80.42],
      [25.55, -80.33], [25.7, -80.25], [25.77, -80.195], [25.85, -80.172], [25.9, -80.14],
    ]),
    cell: 6,
    density: 0.85,
    height: [3, 12],
    seed: 11,
    street: 1.5,
  },
  {
    id: "vice-suburbs",
    style: "residential",
    poly: project([[26.95, -80.07], [26.95, -80.2], [26.6, -80.25], [26.3, -80.28], [26.12, -80.42], [26.12, -80.11], [26.4, -80.07], [26.7, -80.04]]),
    cell: 6,
    density: 0.55,
    height: [1, 3],
    seed: 12,
    street: 1.7,
  },
  { id: "ocean-beach", style: "resort", poly: OCEAN_BEACH_PTS, cell: 3, density: 0.85, height: [4, 16], seed: 13, street: 1.1 },
  {
    id: "port-gellhorn",
    style: "town",
    poly: project([
      [28.2, -82.83], [28.2, -82.4], [28.08, -82.22], [27.85, -82.2], [27.72, -82.3], [27.74, -82.46], [27.66, -82.6], [27.67, -82.77], [27.9, -82.88],
    ]),
    cell: 6,
    density: 0.7,
    height: [2, 8],
    seed: 21,
    street: 1.6,
  },
  town("ambrosia", 26.74, -80.94, 0.035, 0.05, 31),
  town("keys-town", 24.558, -81.78, 0.012, 0.03, 41, "residential"),
  town("orlando", 28.53, -81.38, 0.2, 0.2, 51),
  town("jacksonville", 30.3, -81.62, 0.18, 0.2, 52),
  town("gainesville", 29.65, -82.33, 0.07, 0.08, 53),
  town("ocala", 29.18, -82.13, 0.06, 0.07, 54),
  town("daytona", 29.2, -81.05, 0.09, 0.05, 55),
  town("melbourne", 28.1, -80.65, 0.12, 0.05, 56),
  town("port-st-lucie", 27.3, -80.35, 0.1, 0.07, 57),
  town("fort-myers", 26.6, -81.88, 0.13, 0.1, 58),
  town("naples", 26.17, -81.77, 0.08, 0.04, 59),
  town("sarasota", 27.38, -82.53, 0.15, 0.07, 60),
  town("lakeland", 28.04, -81.95, 0.07, 0.08, 61),
  town("sebring", 27.5, -81.44, 0.05, 0.05, 62),
  town("st-augustine", 29.9, -81.33, 0.05, 0.04, 63),
  town("okeechobee", 27.24, -80.83, 0.03, 0.04, 64),
  town("homestead", 25.47, -80.47, 0.04, 0.05, 65, "residential"),
  town("vero", 27.64, -80.42, 0.05, 0.04, 66),
  town("port-charlotte", 26.98, -82.1, 0.06, 0.08, 67),
  town("marathon", 24.715, -81.06, 0.008, 0.04, 68, "residential"),
  town("palm-coast", 29.55, -81.2, 0.05, 0.04, 69),
  town("titusville", 28.6, -80.83, 0.07, 0.03, 70),
  town("cocoa", 28.37, -80.75, 0.07, 0.03, 71),
  town("merritt", 28.36, -80.68, 0.06, 0.03, 72, "residential"),
  town("stuart", 27.18, -80.25, 0.05, 0.05, 73),
  town("kissimmee", 28.29, -81.42, 0.06, 0.07, 74, "residential"),
  town("sanford", 28.79, -81.3, 0.05, 0.06, 75),
  town("deland", 29.03, -81.3, 0.05, 0.05, 76),
  town("leesburg", 28.81, -81.9, 0.04, 0.05, 77),
  town("villages", 28.93, -81.98, 0.06, 0.06, 78, "residential"),
  town("brooksville", 28.55, -82.39, 0.04, 0.05, 79),
  town("spring-hill", 28.47, -82.56, 0.07, 0.08, 80, "residential"),
  town("crystal-river", 28.9, -82.58, 0.04, 0.04, 81),
  town("bradenton", 27.49, -82.56, 0.06, 0.09, 82),
  town("venice", 27.09, -82.43, 0.06, 0.04, 83, "residential"),
  town("cape-coral", 26.63, -81.99, 0.1, 0.07, 84, "residential"),
  town("immokalee", 26.42, -81.42, 0.03, 0.04, 85),
  town("labelle", 26.76, -81.44, 0.025, 0.035, 86),
  town("belle-glade", 26.68, -80.67, 0.03, 0.035, 87),
  town("arcadia", 27.22, -81.86, 0.03, 0.035, 88),
  town("wauchula", 27.55, -81.81, 0.03, 0.03, 89),
  town("winter-haven", 28.02, -81.73, 0.05, 0.06, 90),
  town("lake-wales", 27.9, -81.59, 0.035, 0.035, 91),
  town("palatka", 29.65, -81.66, 0.035, 0.035, 92),
  town("lake-city", 30.19, -82.64, 0.04, 0.05, 93),
  town("starke", 29.94, -82.11, 0.025, 0.03, 94),
  town("fernandina", 30.66, -81.46, 0.035, 0.025, 95),
  town("chiefland", 29.48, -82.86, 0.025, 0.03, 96),
  town("cross-city", 29.63, -83.12, 0.02, 0.03, 97),
  town("marco", 25.94, -81.71, 0.03, 0.035, 98, "residential"),
  town("everglades-city", 25.86, -81.385, 0.012, 0.015, 99),
  town("key-largo", 25.1, -80.43, 0.03, 0.03, 100, "residential"),
  town("islamorada", 24.925, -80.63, 0.012, 0.02, 101, "residential"),
  town("big-pine", 24.67, -81.36, 0.025, 0.014, 102, "residential"),
  town("new-smyrna", 29.03, -80.93, 0.04, 0.03, 103),
  town("jupiter-inland", 26.93, -80.14, 0.04, 0.05, 104, "residential"),
  town("clewiston-east", 26.75, -80.62, 0.02, 0.025, 105),
  town("okee-west", 27.02, -81.4, 0.02, 0.025, 106),
  town("punta-gorda", 26.92, -82.03, 0.03, 0.03, 107, "residential"),
  town("apopka", 28.68, -81.5, 0.04, 0.05, 108, "residential"),
  town("clermont", 28.55, -81.72, 0.03, 0.035, 109, "residential"),
  town("zephyrhills", 28.24, -82.18, 0.04, 0.04, 110),
  town("dade-city", 28.36, -82.2, 0.025, 0.025, 111),
  town("inverness", 28.84, -82.34, 0.025, 0.025, 112),
  town("plant-city", 28.02, -82.12, 0.035, 0.04, 113),
];

const inLandPoly = polyIndex([MAINLAND_PTS, OCEAN_BEACH_PTS, ...LAND_POLYS]);
const inIsland = isletIndex(ISLETS);

/** True if a point is on dry land (mainland or any island) and not in a lake or pond. */
export function onLand(p: Pt): boolean {
  if (inPond(p) || inLake(p)) return false;
  return inLandPoly(p) || inIsland(p);
}

/* --------------------------------------------------------------- transport */

const road = (pts: LL[]) => smoothPath(project(pts), false);

/** Interstates and the Turnpike. */
export const HIGHWAYS = [
  // I-95
  road([[25.77, -80.205], [26.12, -80.17], [26.7, -80.09], [26.93, -80.13], [27.17, -80.27], [27.43, -80.39], [27.63, -80.47], [28.08, -80.69], [28.35, -80.79], [28.6, -80.84], [29.18, -81.1], [29.88, -81.38], [30.33, -81.66], [30.62, -81.62]]),
  // I-75 (with Alligator Alley)
  road([[25.88, -80.33], [26.1, -80.4], [26.15, -80.9], [26.15, -81.4], [26.2, -81.74], [26.6, -81.8], [26.98, -82.07], [27.3, -82.43], [27.5, -82.48], [27.95, -82.33], [28.55, -82.3], [29.18, -82.2], [29.65, -82.4], [30.18, -82.65], [30.42, -82.75]]),
  // I-4
  road([[27.96, -82.45], [28.04, -81.95], [28.3, -81.6], [28.54, -81.38], [28.8, -81.3], [29.18, -81.1]]),
  // Florida's Turnpike
  road([[25.47, -80.47], [25.65, -80.4], [25.95, -80.3], [26.35, -80.2], [26.75, -80.2], [27.25, -80.4], [27.7, -80.9], [28.25, -81.35], [28.55, -81.5], [28.85, -82.05]]),
  // I-10
  road([[30.33, -81.66], [30.3, -82.2], [30.25, -82.9], [30.2, -83.35]]),
];

/** US and state highways. */
export const ROADS = [
  // Tamiami Trail
  road([[25.76, -80.3], [25.76, -80.8], [25.86, -81.2], [25.97, -81.6], [26.14, -81.78]]),
  // US-27
  road([[25.88, -80.42], [26.3, -80.6], [26.66, -80.72], [26.75, -80.93], [26.83, -81.1], [27.5, -81.44], [27.9, -81.59], [28.55, -81.77], [29.18, -82.14], [29.9, -82.55]]),
  // SR-70
  road([[27.45, -80.33], [27.25, -80.83], [27.22, -81.86], [27.45, -82.55]]),
  // SR-60
  road([[27.64, -80.4], [27.65, -81.2], [27.9, -81.6], [27.95, -82.35]]),
  // US-19 / US-98
  road([[27.97, -82.73], [28.3, -82.7], [28.9, -82.6], [29.47, -82.86], [29.95, -83.5]]),
  // SR-50
  road([[28.54, -81.38], [28.6, -80.85]]),
  // US-441 / US-301
  road([[28.6, -81.5], [29.18, -82.1], [29.65, -82.33], [30.1, -82.1], [30.33, -81.66]]),
  // SR-80
  road([[26.7, -80.07], [26.68, -80.5], [26.75, -80.93]]),
  // SR-29 / SR-31
  road([[25.86, -81.38], [26.42, -81.42], [26.75, -81.43], [27.22, -81.86]]),
  // US-17 / SR-207
  road([[29.9, -81.33], [29.65, -81.65], [29.0, -81.3], [28.8, -81.3]]),
  // US-1 north of Miami
  road([[25.47, -80.47], [25.77, -80.21], [26.7, -80.06], [27.45, -80.33], [28.1, -80.63], [29.2, -81.03], [29.9, -81.32], [30.33, -81.45]]),
];

/** Causeways from the mainland to Miami Beach. */
export const CAUSEWAYS = [
  [geo(25.79, -80.19), geo(25.79, -80.145)],
  [geo(25.825, -80.18), geo(25.828, -80.142)],
  [geo(25.856, -80.168), geo(25.856, -80.142)],
  [geo(25.73, -80.215), geo(25.705, -80.17)],
].map(([a, b]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`);

export const OVERSEAS_HIGHWAY = smoothPath(
  project([
    [25.45, -80.48], [25.3, -80.44], [25.185, -80.39], [25.1, -80.43], [25.02, -80.5], [24.96, -80.57], [24.92, -80.63],
    [24.86, -80.71], [24.815, -80.82], [24.775, -80.915], [24.76, -80.96], [24.72, -81.05], [24.705, -81.12], [24.68, -81.23],
    [24.66, -81.275], [24.668, -81.36], [24.665, -81.41], [24.665, -81.49], [24.65, -81.54], [24.62, -81.61], [24.598, -81.66],
    [24.578, -81.7], [24.57, -81.735], [24.558, -81.78],
  ]),
  false,
  0.4,
);

/**
 * Piers and marina docks: [lat, lon, heading in degrees (0 = east, 90 = south), length in
 * map units, number of side fingers]. Drawn over the water.
 */
export const PIERS: [number, number, number, number, number][] = [
  // Vice City bayfront, the port and Ocean Beach
  [25.772, -80.186, 0, 1.6, 4], [25.76, -80.19, -10, 1.4, 3], [25.8, -80.186, 0, 1.3, 3], [25.74, -80.213, -35, 1.5, 4],
  [25.776, -80.152, 90, 0.9, 0], [25.776, -80.16, 90, 0.9, 0], [25.776, -80.168, 90, 0.9, 0], [25.776, -80.176, 90, 0.9, 0],
  [25.8, -80.121, 0, 2.2, 0], [25.86, -80.117, 0, 1.6, 0], [25.78, -80.145, 180, 1.2, 3],
  [26.1, -80.103, 0, 1.6, 0], [26.19, -80.092, 0, 1.4, 0], [26.61, -80.035, 0, 1.6, 0],
  // Port Gellhorn bay
  [27.773, -82.626, 0, 2.4, 2], [27.76, -82.627, 0, 1.3, 4], [27.74, -82.63, 0, 1.2, 3], [27.93, -82.445, 180, 1.4, 3],
  [27.915, -82.44, 180, 1.2, 3], [27.86, -82.553, 180, 1.4, 3], [27.975, -82.83, 180, 1.8, 0], [27.71, -82.69, 90, 1.2, 4],
  // Keys marinas
  [24.713, -81.085, 100, 1.3, 4], [24.708, -81.1, 100, 1.1, 3], [24.562, -81.805, 200, 1.3, 4], [24.548, -81.78, 100, 1.5, 0],
  [25.09, -80.433, 140, 1.2, 3], [24.925, -80.628, 140, 1.1, 3],
  // Other coasts
  [26.132, -81.808, 180, 1.8, 0], [26.455, -81.955, 200, 1.4, 0], [27.07, -82.455, 180, 1.4, 0], [29.228, -81.005, 0, 1.6, 0],
  [28.368, -80.602, 0, 1.6, 0], [30.287, -81.388, 0, 1.6, 0], [27.47, -80.3, 180, 1.2, 3], [26.93, -82.062, 200, 1.2, 3],
  [30.32, -81.65, 100, 1, 3], [28.41, -80.6, 200, 1.6, 4],
];

/** Airports: [lat, lon, runway length in map units, runway angle in degrees]. */
export const AIRPORTS: [number, number, number, number][] = [
  [25.795, -80.287, 7, 0],
  [26.072, -80.152, 5, -10],
  [26.683, -80.096, 5, 0],
  [27.975, -82.533, 6, 90],
  [28.43, -81.31, 7, 90],
  [30.494, -81.688, 6, 45],
  [26.536, -81.755, 6, 30],
  [24.556, -81.759, 3.4, 20],
];

/** Kept for the 3D buildings layer: no blocks are built on the main airport. */
export const AIRPORT_ZONE: Pt[] = rectPoly(...geo(25.795, -80.287), 9, 5, 0);
/** Old runway list, kept for the 3D layer's airport buildings. */
export const RUNWAYS: [number, number, number, number, number][] = [];

/* -------------------------------------------------------------- lighting */

/** Sun position in scene units (X east, Y up, Z south), used by the 3D layer. */
export const SUN = { x: -900, y: 1200, z: 700 } as const;
/** Ground-shadow offset per unit of building height, in map units (x east, y south). */
export const SHADOW_STEP: Pt = [-SUN.x / SUN.y, -SUN.z / SUN.y];

/* ---------------------------------------------------------- water & coast */

/** Shallow banks: water here stays light far from shore (Florida Bay and the reef tract). */
export const WATER_BANKS: Islet[] = [
  { ...pt(25.0, -80.95), rx: 70, ry: 30, rotate: -8 },
  { ...pt(24.75, -81.35), rx: 70, ry: 12, rotate: -10 },
  { ...pt(25.55, -80.25), rx: 6, ry: 26, rotate: 10 },
];

/* ------------------------------------------------------------ detail tiles */

/**
 * Areas re-rendered at high resolution on top of the base map so close zooms stay sharp.
 * `pxPerUnit` is the desktop target; it is scaled down on small screens / small GPUs.
 */
export const DETAIL_VIEWS = (() => {
  const box = (id: string, lat0: number, lon0: number, lat1: number, lon1: number, pxPerUnit: number) => {
    const [x0, y0] = geo(lat1, lon0);
    const [x1, y1] = geo(lat0, lon1);
    return { id, x: x0, y: y0, w: x1 - x0, h: y1 - y0, pxPerUnit };
  };
  return [
    // Regional tiles first (medium resolution), then the cities on top of them.
    box("north", 28.9, -83.78, 30.8, -81.15, 4.5),
    box("central", 26.95, -82.98, 28.95, -80.25, 4.5),
    box("south", 24.95, -81.98, 27.0, -79.95, 4.5),
    box("vice-city", 25.38, -80.55, 26.98, -79.98, 14),
    box("port-gellhorn", 27.45, -82.92, 28.22, -82.18, 10),
    box("orlando", 28.3, -81.62, 28.78, -81.12, 10),
    box("keys", 24.48, -81.9, 25.35, -80.2, 7),
  ];
})();

export type MapView = { x: number; y: number; w: number; h: number };

/* ------------------------------------------------------------------ regions */

const [, Y_KALAGA] = geo(28.95, 0);
const [X_GELLHORN] = geo(0, -81.75);
const [, Y_SOUTH] = geo(26.55, 0);
const [X_VICE] = geo(0, -80.55);
const [, Y_VICE_N] = geo(27.05, 0);
const KEYS_LINE: Pt[] = project([[25.05, -84.5], [25.1, -81.0], [25.25, -80.55], [25.4, -80.25], [25.42, -78.5]]);
const BIG = 3000;

/** Region polygons — clipped to land when drawn, so they may overshoot into water. */
export const REGION_POLYS: Record<RegionId, Pt[]> = {
  "mount-kalaga": [[-BIG, -BIG], [BIG, -BIG], [BIG, Y_KALAGA], [-BIG, Y_KALAGA]],
  "port-gellhorn": [[-BIG, Y_KALAGA], [X_GELLHORN, Y_KALAGA], [X_GELLHORN, Y_SOUTH], [-BIG, Y_SOUTH]],
  ambrosia: [[X_GELLHORN, Y_KALAGA], [BIG, Y_KALAGA], [BIG, Y_VICE_N], [X_VICE, Y_VICE_N], [X_VICE, Y_SOUTH], [X_GELLHORN, Y_SOUTH]],
  "vice-city": [[X_VICE, Y_VICE_N], [BIG, Y_VICE_N], [BIG, KEYS_LINE[4][1]], ...KEYS_LINE.slice(2, 4).reverse(), [X_VICE, KEYS_LINE[2][1]]],
  grassrivers: [[-BIG, Y_SOUTH], [X_VICE, Y_SOUTH], [X_VICE, KEYS_LINE[2][1]], KEYS_LINE[1], KEYS_LINE[0]],
  "leonida-keys": [...KEYS_LINE, [KEYS_LINE[4][0], BIG], [KEYS_LINE[0][0], BIG]],
};

export const REGION_SHAPES: Record<RegionId, string> = Object.fromEntries(
  Object.entries(REGION_POLYS).map(([id, poly]) => [id, polyPath(poly)]),
) as Record<RegionId, string>;

export const REGION_BOUNDARIES = [
  `M${-BIG} ${Y_KALAGA} L${BIG} ${Y_KALAGA}`,
  `M${X_GELLHORN} ${Y_KALAGA} L${X_GELLHORN} ${Y_SOUTH}`,
  `M${-BIG} ${Y_SOUTH} L${X_VICE} ${Y_SOUTH}`,
  `M${X_VICE} ${Y_VICE_N} L${BIG} ${Y_VICE_N}`,
  `M${X_VICE} ${Y_VICE_N} L${X_VICE} ${KEYS_LINE[2][1]}`,
  `M${KEYS_LINE.map((p) => p.join(" ")).join(" L")}`,
];

const focus = (lat: number, lon: number, span: number) => {
  const [x, y] = geo(lat, lon);
  return { x, y, span };
};

/** Camera framing for the region quick-jump buttons. */
export const REGION_FOCUS: Record<RegionId, { x: number; y: number; span: number }> = {
  "port-gellhorn": focus(27.85, -82.5, 220),
  "mount-kalaga": focus(29.75, -82.2, 520),
  ambrosia: focus(27.75, -81.25, 520),
  "vice-city": focus(25.95, -80.25, 200),
  grassrivers: focus(25.85, -81.0, 360),
  "leonida-keys": focus(24.85, -81.1, 320),
};

/* ------------------------------------------------------------------- labels */

export interface MapLabel {
  text: string;
  x: number;
  y: number;
  size: number;
  rotate?: number;
  kind: "region" | "district" | "water";
}

const label = (text: string, lat: number, lon: number, size: number, kind: MapLabel["kind"], rotate?: number): MapLabel => {
  const [x, y] = geo(lat, lon);
  return { text, x, y, size, kind, rotate };
};

export const DISTRICT_LABELS: MapLabel[] = [
  label("DOWNTOWN", 25.765, -80.24, 3.2, "district"),
  label("OCEAN BEACH", 25.83, -80.1, 3.2, "district", 90),
  label("KEY LENTO", 24.68, -81.1, 4.5, "district"),
  label("INTERNATIONAL AIRPORT", 25.81, -80.29, 2, "district"),
  label("THE GULF", 27.0, -83.3, 26, "water", -80),
  label("ATLANTIC OCEAN", 28.2, -79.85, 24, "water", 80),
  label("FLORA BAY", 25.02, -80.85, 9, "water", -8),
  label("LAKE LEONIDA", 26.95, -80.83, 7, "water"),
];
