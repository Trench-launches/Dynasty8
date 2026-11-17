/**
 * Geometry for the Leonida map. Original artwork: a stylised, Florida-like island
 * state drawn from our own coordinates — not traced from any game map.
 *
 * Units are map-world units: x grows east (0..MAP_WIDTH), y grows south (0..MAP_HEIGHT).
 * The texture is rendered for TEXTURE_AREA, which adds an ocean margin around the world.
 */

import type { RegionId } from "@/lib/types";

export type Pt = [number, number];

export const TEXTURE_AREA = { x: -150, y: -150, w: 1500, h: 1900 };

/* ------------------------------------------------------------------ helpers */

/** Closed Catmull-Rom spline through the points, as an SVG path. */
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

/* -------------------------------------------------------------- landmasses */

export const MAINLAND_PTS: Pt[] = [
  [150, 340], [175, 245], [240, 175], [330, 130], [440, 105], [560, 92], [690, 88], [810, 98],
  [905, 118], [975, 150], [1015, 200], [1005, 250], [1030, 300], [1050, 380], [1062, 470],
  [1068, 560], [1072, 650], [1074, 740], [1070, 820], [1058, 890], [1040, 940], [1030, 1000],
  [1026, 1060], [1022, 1120], [1008, 1180], [985, 1235], [948, 1280], [900, 1312], [840, 1336],
  [775, 1348], [715, 1338], [660, 1310], [615, 1272], [570, 1235], [532, 1190], [495, 1150],
  [462, 1102], [432, 1050], [408, 995], [390, 940], [372, 890], [350, 845], [325, 805], [300, 770],
  [282, 735], [262, 705], [240, 680], [222, 650], [205, 615], [190, 575], [176, 530], [164, 480],
  [155, 420],
];
export const MAINLAND = smoothPath(MAINLAND_PTS);

/** East-coast stretch of the mainland outline, used for the beach line. */
export const EAST_BEACH = smoothPath(MAINLAND_PTS.slice(12, 20), false);

export const OCEAN_BEACH_PTS: Pt[] = [
  [1066, 925], [1080, 930], [1094, 980], [1102, 1060], [1100, 1140], [1088, 1190], [1076, 1195],
  [1072, 1150], [1074, 1070], [1068, 990], [1062, 940],
];
export const OCEAN_BEACH_ISLAND = smoothPath(OCEAN_BEACH_PTS);
export const OCEAN_BEACH_SAND = smoothPath(OCEAN_BEACH_PTS.slice(1, 6), false);

export const BARRIER_ISLANDS: Islet[] = [
  { cx: 1086, cy: 420, rx: 7, ry: 100, rotate: -4 },
  { cx: 1094, cy: 632, rx: 7, ry: 86, rotate: -1 },
  { cx: 1094, cy: 808, rx: 6, ry: 64, rotate: 3 },
];

export const BAY_ISLANDS: Islet[] = [
  { cx: 1049, cy: 1012, rx: 9, ry: 6, rotate: -10 },
  { cx: 1047, cy: 1092, rx: 7, ry: 5, rotate: 0 },
  { cx: 1050, cy: 1148, rx: 6, ry: 6, rotate: 0 },
];

export const KEYS: Islet[] = [
  { cx: 730, cy: 1388, rx: 24, ry: 8, rotate: -30 },
  { cx: 668, cy: 1420, rx: 34, ry: 10, rotate: -22 },
  { cx: 590, cy: 1450, rx: 48, ry: 14, rotate: -14 },
  { cx: 490, cy: 1476, rx: 30, ry: 9, rotate: -8 },
  { cx: 410, cy: 1490, rx: 24, ry: 8, rotate: -4 },
  { cx: 318, cy: 1500, rx: 44, ry: 15, rotate: -2 },
  { cx: 705, cy: 1403, rx: 3.5, ry: 3, rotate: 0 },
  { cx: 545, cy: 1468, rx: 3.5, ry: 3, rotate: 0 },
  { cx: 450, cy: 1486, rx: 3, ry: 2.5, rotate: 0 },
  { cx: 365, cy: 1496, rx: 3, ry: 2.5, rotate: 0 },
];

/** Water cut into the land (drawn over it). */
export const HARBOUR: Islet = { cx: 208, cy: 410, rx: 54, ry: 20, rotate: 18 };
export const LAKE: Islet = { cx: 640, cy: 640, rx: 105, ry: 80, rotate: -8 };

export const RIVERS = [
  "M545 660 C500 690 470 700 420 720 C380 735 330 740 285 738",
  "M700 712 C710 780 690 840 700 900 C708 960 680 1020 690 1080 C700 1150 720 1220 735 1300",
];

/* ------------------------------------------------------------------ land use */

export const KALAGA_FOREST: Pt[] = [[440, 100], [900, 110], [880, 330], [430, 335]];
export const AMBROSIA_FARMS: Pt[] = [[440, 345], [880, 345], [890, 560], [800, 760], [560, 700], [440, 620]];
export const GRASSRIVERS_WETLAND: Pt[] = [
  [420, 720], [700, 760], [850, 860], [880, 1240], [800, 1330], [660, 1300], [520, 1180], [420, 1020],
];

/* -------------------------------------------------------------- urban areas */

export type UrbanStyle = "downtown" | "residential" | "resort" | "town";

export interface UrbanArea {
  id: string;
  /** What the blocks are filled with: towers, houses with pools, beach hotels, or a mix. */
  style: UrbanStyle;
  poly: Pt[];
  cell: number;
  density: number;
  /** Building height range in map units for the 3D layer. */
  height: [number, number];
  seed: number;
}

export const DOWNTOWN: { x: number; y: number; r: number } = { x: 985, y: 1052, r: 62 };

export const URBAN_AREAS: UrbanArea[] = [
  {
    id: "vice-city",
    style: "downtown",
    poly: [
      [860, 890], [1050, 890], [1034, 940], [1024, 1000], [1020, 1060], [1016, 1120], [1002, 1180],
      [978, 1232], [930, 1250], [880, 1222], [852, 1100], [846, 980],
    ],
    cell: 12,
    density: 0.86,
    height: [4, 14],
    seed: 11,
  },
  {
    id: "vice-suburbs",
    style: "residential",
    poly: [[905, 580], [1056, 575], [1060, 700], [1058, 820], [1044, 884], [870, 884], [890, 760], [920, 650]],
    cell: 13,
    density: 0.5,
    height: [2, 5],
    seed: 12,
  },
  {
    id: "ocean-beach",
    style: "resort",
    poly: OCEAN_BEACH_PTS,
    cell: 9,
    density: 0.85,
    height: [6, 26],
    seed: 13,
  },
  {
    id: "port-gellhorn",
    style: "town",
    poly: [[178, 335], [330, 325], [352, 410], [340, 480], [290, 505], [205, 492], [172, 455]],
    cell: 12,
    density: 0.62,
    height: [3, 9],
    seed: 21,
  },
  {
    id: "ambrosia",
    style: "town",
    poly: [[720, 430], [830, 425], [840, 505], [760, 520], [718, 490]],
    cell: 11,
    density: 0.6,
    height: [3, 8],
    seed: 31,
  },
  {
    id: "keys-town",
    style: "residential",
    poly: [[282, 1494], [352, 1490], [356, 1506], [286, 1512]],
    cell: 8,
    density: 0.7,
    height: [2, 6],
    seed: 41,
  },
];

/** True if a point is on dry land (mainland or any island) and not in a lake/harbour. */
export function onLand(pt: Pt): boolean {
  if (inIslet(pt, LAKE) || inIslet(pt, HARBOUR, 1.15)) return false;
  return (
    pointInPolygon(pt, MAINLAND_PTS) ||
    pointInPolygon(pt, OCEAN_BEACH_PTS) ||
    KEYS.some((k) => inIslet(pt, k, 0.85))
  );
}

/* --------------------------------------------------------------- transport */

export const HIGHWAYS = [
  // East coast turnpike
  "M990 160 C1010 260 1040 380 1046 480 C1052 600 1050 720 1040 820 C1030 900 1000 960 990 1040 C980 1120 960 1200 900 1270 C860 1310 810 1330 775 1345",
  // North cross-state
  "M300 380 C350 350 400 335 450 330 C520 322 560 305 600 300 C680 292 720 285 760 280 C840 270 880 258 900 250 C940 236 970 220 990 200",
  // Gulf coast highway
  "M300 380 C260 470 230 560 240 650 C250 720 300 800 340 870 C380 940 420 1010 470 1080",
  // Cross-wetland expressway
  "M470 1080 C600 1060 720 1050 860 1030 C910 1025 950 1035 990 1040",
  // Central spine
  "M760 280 C780 420 792 520 790 640 C790 760 840 860 870 920",
];

export const ROADS = [
  "M330 130 C360 220 380 300 420 340",
  "M560 92 C570 200 600 300 640 400",
  "M164 480 C220 520 300 540 430 560",
  "M500 900 C560 960 620 1000 700 1050",
  "M880 600 C920 700 960 780 1000 860",
  "M600 300 C560 420 520 520 470 600",
  "M790 640 C700 600 620 560 540 560",
  "M880 1222 C850 1260 800 1290 760 1320",
];

export const CAUSEWAYS = ["M1030 1000 L1070 990", "M1025 1090 L1074 1085", "M1015 1160 L1074 1160"];

export const OVERSEAS_HIGHWAY =
  "M775 1345 C755 1365 742 1378 730 1388 S690 1410 668 1420 S620 1440 590 1450 S520 1470 490 1476 S440 1486 410 1490 S350 1498 318 1500";

/** Airport runways: [x, y, length, width, rotationDeg] */
export const RUNWAYS: [number, number, number, number, number][] = [
  [868, 1160, 70, 5, -20],
  [880, 1180, 60, 5, -20],
  [862, 1186, 40, 4, 40],
  [395, 360, 50, 4, 10],
];

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

/** Vice City International: no city blocks are built inside this zone. */
export const AIRPORT_ZONE: Pt[] = rectPoly(873, 1174, 104, 58, -20);

/* -------------------------------------------------------------- lighting */

/**
 * Sun position in scene units (X east, Y up, Z south) — an afternoon sun from the south-west.
 * The 3D light and the shadows baked into the ground texture both use it.
 */
export const SUN = { x: -900, y: 1200, z: 700 } as const;
/** Ground-shadow offset per unit of building height, in map units (x east, y south). */
export const SHADOW_STEP: Pt = [-SUN.x / SUN.y, -SUN.z / SUN.y];

/* ---------------------------------------------------------- water & coast */

/** Shallow sand banks: water here stays turquoise far from shore. */
export const WATER_BANKS: Islet[] = [
  { cx: 640, cy: 1420, rx: 360, ry: 120, rotate: -6 },
  { cx: 960, cy: 1300, rx: 160, ry: 70, rotate: 0 },
  { cx: 1068, cy: 1060, rx: 40, ry: 190, rotate: 0 },
  { cx: 1098, cy: 600, rx: 24, ry: 320, rotate: 0 },
];

/** Stretches of coast with sandy beaches (land inside these boxes gets a sand rim). */
export const BEACH_ZONES: Pt[][] = [
  [[960, 100], [1200, 100], [1200, 915], [960, 915]],
  [[1076, 900], [1200, 900], [1200, 1230], [1076, 1230]],
  [[100, 480], [330, 480], [330, 820], [100, 820]],
  [[250, 1395], [800, 1395], [800, 1560], [250, 1560]],
];

/* ------------------------------------------------------------ detail tiles */

/**
 * Areas re-rendered at high resolution on top of the base map so close zooms stay sharp.
 * `pxPerUnit` is the desktop target; it is scaled down on small screens / small GPUs.
 */
export const DETAIL_VIEWS = [
  { id: "vice-core", x: 836, y: 876, w: 284, h: 388, pxPerUnit: 8 },
  { id: "vice-north", x: 858, y: 564, w: 212, h: 330, pxPerUnit: 6 },
] as const;

export type MapView = { x: number; y: number; w: number; h: number };

/* ------------------------------------------------------------------ regions */

/** Region polygons — clipped to land when drawn, so they may overshoot into water. */
export const REGION_SHAPES: Record<RegionId, string> = {
  "port-gellhorn": "M-1000 -1000 L430 -1000 L430 600 L-1000 600 Z",
  "mount-kalaga": "M430 -1000 L2200 -1000 L2200 330 L430 330 Z",
  ambrosia: "M430 330 L2200 330 L2200 560 L900 560 L850 840 L700 780 L430 640 Z",
  "vice-city": "M900 560 L2200 560 L2200 1360 L880 1360 L850 840 Z",
  grassrivers: "M-1000 600 L430 600 L430 640 L700 780 L850 840 L880 1360 L-1000 1360 Z",
  "leonida-keys": "M-1000 1360 L2200 1360 L2200 3000 L-1000 3000 Z",
};

export const REGION_BOUNDARIES = [
  "M430 -1000 L430 640",
  "M-1000 600 L430 600",
  "M430 330 L2200 330",
  "M900 560 L2200 560",
  "M900 560 L850 840",
  "M430 640 L700 780 L850 840",
  "M850 840 L880 1360",
  "M-1000 1360 L2200 1360",
];

/** Camera framing for the region quick-jump buttons. */
export const REGION_FOCUS: Record<RegionId, { x: number; y: number; span: number }> = {
  "port-gellhorn": { x: 270, y: 420, span: 420 },
  "mount-kalaga": { x: 660, y: 220, span: 640 },
  ambrosia: { x: 720, y: 520, span: 620 },
  "vice-city": { x: 965, y: 1050, span: 440 },
  grassrivers: { x: 600, y: 1030, span: 640 },
  "leonida-keys": { x: 530, y: 1450, span: 560 },
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

export const DISTRICT_LABELS: MapLabel[] = [
  { text: "DOWNTOWN", x: 950, y: 1010, size: 13, kind: "district" },
  { text: "OCEAN BEACH", x: 1135, y: 1060, size: 13, rotate: 90, kind: "district" },
  { text: "KEY LENTO", x: 590, y: 1485, size: 13, kind: "district" },
  { text: "INTERNATIONAL AIRPORT", x: 860, y: 1215, size: 9, kind: "district" },
  { text: "THE GULF", x: 70, y: 900, size: 22, rotate: -80, kind: "water" },
  { text: "ATLANTIC OCEAN", x: 1230, y: 560, size: 22, rotate: 86, kind: "water" },
  { text: "FLORA BAY", x: 760, y: 1440, size: 16, rotate: -12, kind: "water" },
  { text: "LAKE LEONIDA", x: 640, y: 645, size: 13, kind: "water" },
];
