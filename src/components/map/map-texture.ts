/**
 * Paints Leonida as a flat 2D road map in the Dynasty 8 site style: flat light-blue water,
 * greens for natural land, grey towns with white streets, a dense white road network with
 * grey casings, yellow beaches and light-blue lakes, ponds, rivers and canals. Original
 * artwork generated in code from our own geometry (a stylised Florida, see geometry.ts).
 *
 * Pipeline
 * 1. Low-res "fields" for the whole map (computed once): water colour from a coastline
 *    distance field, land colour from soft land-use masks.
 * 2. A road network (computed once): real highways from geometry.ts plus procedurally
 *    generated county roads, farm section roads and forest tracks.
 * 3. `paintLayer` draws a view of the map at any resolution. The base layer covers the whole
 *    map; detail layers re-render regions and cities at higher resolution so zooms stay sharp.
 */

import { REGIONS } from "@/data/regions";
import {
  AIRPORTS,
  ALL_ISLETS,
  BARRIER_ISLANDS,
  BEACH_PATHS,
  CAUSEWAYS,
  DETAIL_VIEWS,
  DISTRICT_LABELS,
  FARMS,
  FORESTS,
  HIGHWAYS,
  LAKE_POLYS,
  LAND_POLYS,
  MAINLAND,
  OCEAN_BEACH_ISLAND,
  OCEAN_BEACH_SHORE,
  OVERSEAS_HIGHWAY,
  PIERS,
  PONDS,
  REGION_BOUNDARIES,
  ROADS,
  SANDY_POLYS,
  TEXTURE_AREA,
  URBAN_AREAS,
  WATERWAYS,
  WATER_BANKS,
  WETLANDS,
  geo,
  onLand,
  pointInPolygon,
  seeded,
  smoothPath,
  type Islet,
  type MapLabel,
  type MapView,
  type Pt,
  type UrbanArea,
} from "./geometry";
import { blurField, distanceField, fbm, hex, ramp, rgbString, smoothstep, type RGB } from "./noise";
import { streetPlan, type District } from "./street-plan";

export const MAP_COLORS = {
  /** Open sea — also the fallback colour of the endless sea plane beyond the texture. */
  ocean: "#84bcef",
} as const;

const A = TEXTURE_AREA;
/** Map units per pixel of the low-res fields. */
const FIELD_RES = 1.5;

/**
 * Let the browser breathe between heavy steps. A MessageChannel round-trip is used because
 * setTimeout and scheduler.yield are heavily throttled in background tabs, which would stall
 * the map if the visitor switches tabs while it loads.
 */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/* ------------------------------------------------------------------ palette */

const oceanRamp = ramp([
  [0, hex("#a9d5f8")],
  [2, hex("#9acbf5")],
  [8, hex("#8ec4f3")],
  [25, hex("#88bff1")],
  [70, hex(MAP_COLORS.ocean)],
]);

const lakeRamp = ramp([
  [0, hex("#a9d5f8")],
  [3, hex("#98caf5")],
  [15, hex("#8ec4f3")],
]);

const LAND = {
  base: hex("#86b47c"),
  alt: hex("#7bab72"),
  farm: hex("#a5c594"),
  wet: hex("#93bf88"),
  wetDark: hex("#79aa70"),
  forest: hex("#62955c"),
  forestDark: hex("#54824f"),
  mangrove: hex("#5d9158"),
};

const C = {
  urban: "#a7a7ab",
  urbanDark: "#9a9a9f",
  urbanEdge: "#9b9ba0",
  park: "#7aab6e",
  street: "#ffffff",
  casing: "#8c8c92",
  sand: "#f2c33a",
  river: "#9bcdf6",
  runway: "#76767c",
  apron: "#bdbdc2",
};

/* ------------------------------------------------------------------ shapes */

function ellipsePath(e: Islet, scale = 1): Path2D {
  const p = new Path2D();
  p.ellipse(e.cx, e.cy, e.rx * scale, e.ry * scale, (e.rotate * Math.PI) / 180, 0, Math.PI * 2);
  return p;
}

function polyPath2D(pts: Pt[], smooth = false): Path2D {
  if (smooth) return new Path2D(smoothPath(pts, true, 0.4));
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

interface Shapes {
  /** Mainland and every island. All sub-paths wind the same way, so it fills as a union. */
  land: Path2D;
  /** Lakes and ponds (water drawn over the land). */
  inland: Path2D;
  /** The named lakes only. */
  lakes: Path2D;
  /** Rivers, lagoons and canals with their stroke widths. */
  waterways: { path: Path2D; width: number }[];
}

let shapeCache: Shapes | null = null;
function shapes(): Shapes {
  if (shapeCache) return shapeCache;
  const land = new Path2D();
  land.addPath(new Path2D(MAINLAND));
  land.addPath(new Path2D(OCEAN_BEACH_ISLAND));
  for (const poly of LAND_POLYS) land.addPath(polyPath2D(poly, true));
  for (const e of ALL_ISLETS) land.addPath(ellipsePath(e));
  const lakes = new Path2D();
  for (const l of LAKE_POLYS) lakes.addPath(polyPath2D(l, true));
  const inland = new Path2D();
  inland.addPath(lakes);
  for (const e of PONDS) inland.addPath(ellipsePath(e));
  const waterways = WATERWAYS.map((w) => ({ path: new Path2D(w.d), width: w.width }));
  shapeCache = { land, inland, lakes, waterways };
  return shapeCache;
}

/* ------------------------------------------------------------------ fields */

interface Fields {
  water: HTMLCanvasElement;
  land: HTMLCanvasElement;
  w: number;
  h: number;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function rasterMask(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Float32Array {
  const c = canvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(1 / FIELD_RES, 0, 0, 1 / FIELD_RES, -A.x / FIELD_RES, -A.y / FIELD_RES);
  ctx.fillStyle = "#fff";
  draw(ctx);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4 + 3] / 255;
  return out;
}

const BANKS = WATER_BANKS.map((e) => {
  const a = (-e.rotate * Math.PI) / 180;
  return { ...e, cos: Math.cos(a), sin: Math.sin(a), reach: Math.max(e.rx, e.ry) };
});

function bankWeight(x: number, y: number): number {
  let best = 0;
  for (const e of BANKS) {
    const dx = x - e.cx;
    const dy = y - e.cy;
    if (dx > e.reach || dx < -e.reach || dy > e.reach || dy < -e.reach) continue;
    const u = (dx * e.cos - dy * e.sin) / e.rx;
    const v = (dx * e.sin + dy * e.cos) / e.ry;
    const d = Math.sqrt(u * u + v * v);
    if (d < 1) best = Math.max(best, 1 - smoothstep(0.4, 1, d));
  }
  return best;
}

function mixInto(c: RGB, b: RGB, t: number) {
  c[0] += (b[0] - c[0]) * t;
  c[1] += (b[1] - c[1]) * t;
  c[2] += (b[2] - c[2]) * t;
}

const COAST_BAND = 6;

async function computeFields(): Promise<Fields> {
  const w = Math.ceil(A.w / FIELD_RES);
  const h = Math.ceil(A.h / FIELD_RES);
  const S = shapes();

  const landM = rasterMask(w, h, (ctx) => {
    ctx.fill(S.land);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill(S.inland);
  });
  const lakeM = rasterMask(w, h, (ctx) => ctx.fill(S.lakes));
  const forestM = rasterMask(w, h, (ctx) => FORESTS.forEach((p) => ctx.fill(polyPath2D(p, true))));
  const wetM = rasterMask(w, h, (ctx) => WETLANDS.forEach((p) => ctx.fill(polyPath2D(p, true))));
  const farmM = rasterMask(w, h, (ctx) => FARMS.forEach((p) => ctx.fill(polyPath2D(p, true))));
  blurField(forestM, w, h, 6);
  blurField(wetM, w, h, 6);
  blurField(farmM, w, h, 5);
  await yieldFrame();

  const isLand = (i: number) => landM[i] > 0.5;
  const dOut = distanceField(w, h, isLand);
  const dIn = distanceField(w, h, (i) => !isLand(i));
  await yieldFrame();

  const water = new ImageData(w, h);
  const land = new ImageData(w, h);
  const lc: RGB = [0, 0, 0];
  const tmp: RGB = [0, 0, 0];
  const interior = oceanRamp(0);

  for (let y = 0; y < h; y++) {
    if (y % 160 === 0) await yieldFrame();
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const mx = A.x + (x + 0.5) * FIELD_RES;
      const my = A.y + (y + 0.5) * FIELD_RES;
      const onLandPx = landM[i] > 0.5;
      const dist = dOut[i] * FIELD_RES;
      const din = dIn[i] * FIELD_RES;

      let wc: RGB = interior;
      if (!onLandPx || din < COAST_BAND) {
        if (lakeM[i] > 0.5) {
          wc = lakeRamp(dist);
        } else {
          let depth = dist;
          const bank = bankWeight(mx, my);
          if (bank > 0) depth = depth * (1 - bank) + Math.min(depth, 4) * bank;
          const edge = Math.min(x, y, w - 1 - x, h - 1 - y) * FIELD_RES;
          depth = Math.max(depth, 80 * (1 - smoothstep(0, 40, edge)));
          wc = oceanRamp(depth);
        }
      }
      water.data[o] = wc[0];
      water.data[o + 1] = wc[1];
      water.data[o + 2] = wc[2];
      water.data[o + 3] = 255;

      lc[0] = LAND.base[0];
      lc[1] = LAND.base[1];
      lc[2] = LAND.base[2];
      if (onLandPx || dist < COAST_BAND) {
        const n = fbm(mx * 0.01, my * 0.01, 2, 11);
        mixInto(lc, LAND.alt, smoothstep(0.45, 0.65, n) * 0.7);
        const wA = farmM[i];
        const wW = wetM[i];
        const wF = forestM[i];
        if (wA > 0.01) mixInto(lc, LAND.farm, wA * 0.9);
        if (wW > 0.01) {
          tmp[0] = LAND.wet[0];
          tmp[1] = LAND.wet[1];
          tmp[2] = LAND.wet[2];
          mixInto(tmp, LAND.wetDark, smoothstep(0.52, 0.6, fbm(mx * 0.05, my * 0.05, 2, 41)));
          mixInto(lc, tmp, wW);
        }
        if (wF > 0.01) {
          tmp[0] = LAND.forest[0];
          tmp[1] = LAND.forest[1];
          tmp[2] = LAND.forest[2];
          mixInto(tmp, LAND.forestDark, smoothstep(0.5, 0.58, fbm(mx * 0.04, my * 0.04, 2, 43)));
          mixInto(lc, tmp, wF);
        }
        const southWest = my > 1150 && my < 1370 && mx < 860;
        if (southWest && din < 5) mixInto(lc, LAND.mangrove, (1 - smoothstep(1, 4, din)) * 0.9);
      }
      land.data[o] = lc[0];
      land.data[o + 1] = lc[1];
      land.data[o + 2] = lc[2];
      land.data[o + 3] = 255;
    }
  }

  const toCanvas = (img: ImageData) => {
    const c = canvas(w, h);
    c.getContext("2d")!.putImageData(img, 0, 0);
    return c;
  };
  return { water: toCanvas(water), land: toCanvas(land), w, h };
}

let fieldsPromise: Promise<Fields> | null = null;
const getFields = () => (fieldsPromise ??= computeFields());

/* ------------------------------------------------------------- road network */

interface RoadNetwork {
  /** County roads between towns. */
  county: Path2D;
  /** Section-line roads through farmland and the countryside. */
  rural: Path2D;
  /** Winding tracks through the forests. */
  tracks: Path2D;
}

function centroid(poly: Pt[]): Pt {
  const n = poly.length;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}

function inWetland(p: Pt) {
  return WETLANDS.slice(0, 2).some((w) => pointInPolygon(p, w));
}

/** Fraction of samples along a segment that are on dry land. */
function landFraction(a: Pt, b: Pt, samples = 16) {
  let ok = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    if (onLand([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) ok++;
  }
  return ok / (samples + 1);
}

let networkCache: RoadNetwork | null = null;
function roadNetwork(): RoadNetwork {
  if (networkCache) return networkCache;
  const r = seeded(4242);

  // Towns plus scattered villages.
  const nodes: Pt[] = URBAN_AREAS.filter((a) => a.id !== "ocean-beach").map((a) => centroid(a.poly));
  for (let i = 0; i < 260; i++) {
    const p: Pt = [A.x + r() * A.w, A.y + r() * A.h];
    if (onLand(p) && !inWetland(p)) nodes.push(p);
  }

  // County roads: link each node to its nearest neighbours with a gentle bend.
  const county = new Path2D();
  const seen = new Set<string>();
  nodes.forEach((a, i) => {
    const near = nodes
      .map((b, j) => ({ j, d: Math.hypot(b[0] - a[0], b[1] - a[1]) }))
      .filter((e) => e.j !== i && e.d < 70)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = nodes[j];
      if (landFraction(a, b) < 0.97) continue;
      const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (inWetland(mid)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bend = (r() - 0.5) * len * 0.25;
      const nx = -(b[1] - a[1]) / len;
      const ny = (b[0] - a[0]) / len;
      county.moveTo(a[0], a[1]);
      county.quadraticCurveTo(mid[0] + nx * bend, mid[1] + ny * bend, b[0], b[1]);
    }
  });

  // Section-line roads: a jittered grid with random gaps, densest in farmland.
  const rural = new Path2D();
  const step = 11;
  const jitter = (x: number, y: number): Pt => [x + (seeded(Math.floor(x * 7 + y * 131))() - 0.5) * 3, y];
  for (let y = A.y; y < A.y + A.h; y += step) {
    for (let x = A.x; x < A.x + A.w; x += step) {
      const a = jitter(x, y);
      const farm = FARMS.some((f) => pointInPolygon(a, f));
      const chance = farm ? 0.75 : 0.22;
      for (const [dx, dy] of [[step, 0], [0, step]]) {
        if (r() > chance) continue;
        const b = jitter(x + dx, y + dy);
        if (!onLand(a) || !onLand(b) || inWetland(a) || inWetland(b)) continue;
        rural.moveTo(a[0], a[1]);
        rural.lineTo(b[0], b[1]);
      }
    }
  }

  // Forest tracks: meandering lines.
  const tracks = new Path2D();
  for (const forest of FORESTS) {
    const xs = forest.map((p) => p[0]);
    const ys = forest.map((p) => p[1]);
    for (let i = 0; i < 18; i++) {
      let x = Math.min(...xs) + r() * (Math.max(...xs) - Math.min(...xs));
      let y = Math.min(...ys) + r() * (Math.max(...ys) - Math.min(...ys));
      if (!pointInPolygon([x, y], forest)) continue;
      let heading = r() * Math.PI * 2;
      tracks.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        heading += (r() - 0.5) * 0.9;
        x += Math.cos(heading) * 2.5;
        y += Math.sin(heading) * 2.5;
        tracks.lineTo(x, y);
      }
    }
  }

  networkCache = { county, rural, tracks };
  return networkCache;
}

/* ------------------------------------------------------------------ helpers */

interface Painter {
  ctx: CanvasRenderingContext2D;
  view: MapView;
  ppu: number;
  /** Major roads are drawn a little slimmer on the high-resolution city layers. */
  roadScale: number;
}

function inView(p: Painter, x: number, y: number, margin = 0) {
  const v = p.view;
  return x > v.x - margin && x < v.x + v.w + margin && y > v.y - margin && y < v.y + v.h + margin;
}

/** Stroke a road with a grey casing; `minPx` keeps it visible at low resolutions. */
function strokeRoad(p: Painter, path: Path2D | string, width: number, minPx = 0.8) {
  const { ctx } = p;
  const path2d = typeof path === "string" ? new Path2D(path) : path;
  const w = Math.max(width, minPx / p.ppu);
  ctx.strokeStyle = C.casing;
  ctx.lineWidth = w + Math.max(width * 0.45, 0.6 / p.ppu);
  ctx.stroke(path2d);
  ctx.strokeStyle = C.street;
  ctx.lineWidth = w;
  ctx.stroke(path2d);
}

function strokeWaterways(ctx: CanvasRenderingContext2D, filter: (width: number) => boolean) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const w of shapes().waterways) {
    if (!filter(w.width)) continue;
    ctx.lineWidth = w.width;
    ctx.stroke(w.path);
  }
}

/** Rivers this wide or wider cut the minor roads; narrower ones are bridged. */
const WIDE_WATER = 1.8;

/* ---------------------------------------------------------- natural layers */

function paintWater(p: Painter, f: Fields) {
  const { ctx } = p;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(f.water, A.x, A.y, A.w, A.h);
}

function paintLand(p: Painter, f: Fields) {
  const { ctx } = p;
  const S = shapes();
  ctx.save();
  ctx.clip(S.land);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(f.land, A.x, A.y, A.w, A.h);

  // Field patchwork in farmland.
  const r = seeded(77);
  const shades = ["#a9c794", "#b3cd9d", "#9fbf8b", "#b8cfa0"];
  for (const farm of FARMS) {
    ctx.save();
    ctx.clip(polyPath2D(farm, true));
    const xs = farm.map((q) => q[0]);
    const ys = farm.map((q) => q[1]);
    for (let y = Math.min(...ys); y < Math.max(...ys); y += 5.5) {
      for (let x = Math.min(...xs); x < Math.max(...xs); x += 5.5) {
        const pick = r();
        if (!inView(p, x, y, 6) || pick > 0.6) continue;
        ctx.fillStyle = shades[Math.floor(pick * 6.6) % shades.length];
        ctx.fillRect(x, y, 5.5, 5.5);
      }
    }
    ctx.restore();
  }

  // Streams, narrow rivers and canals (minor roads bridge them).
  ctx.strokeStyle = C.river;
  strokeWaterways(ctx, (w) => w < WIDE_WATER);
  ctx.restore();
}

/** Lakes, ponds, broad rivers and lagoons, painted over the land and the minor roads. */
function paintInlandWater(p: Painter, f: Fields) {
  const { ctx } = p;
  const S = shapes();
  ctx.save();
  ctx.clip(S.land);
  ctx.strokeStyle = C.river;
  strokeWaterways(ctx, (w) => w >= WIDE_WATER);
  ctx.restore();

  ctx.save();
  ctx.clip(S.inland);
  ctx.drawImage(f.water, A.x, A.y, A.w, A.h);
  ctx.restore();
}

function paintBeaches(p: Painter) {
  const { ctx } = p;
  const S = shapes();
  ctx.save();
  ctx.clip(S.land);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = C.sand;
  ctx.lineWidth = 2.8;
  for (const d of BEACH_PATHS) ctx.stroke(new Path2D(d));
  ctx.lineWidth = 2.4;
  ctx.stroke(new Path2D(OCEAN_BEACH_SHORE));
  ctx.lineWidth = 1.5;
  for (const poly of SANDY_POLYS) ctx.stroke(polyPath2D(poly, true));
  ctx.lineWidth = 0.9;
  for (const e of BARRIER_ISLANDS) ctx.stroke(ellipsePath(e));
  // River mouths and inlets stay open through the sand.
  ctx.strokeStyle = C.river;
  strokeWaterways(ctx, (w) => w >= WIDE_WATER);
  ctx.restore();
}

/* -------------------------------------------------------------------- towns */

function paintDistrict(p: Painter, d: District) {
  const { ctx } = p;
  if (!inView(p, d.cx, d.cy, d.r)) return;
  const cell = polyPath2D(d.poly);
  const r = seeded(d.seed);
  const local = Math.max(0.24, 0.7 / p.ppu);
  ctx.save();
  ctx.clip(cell);

  if (d.kind === "park") {
    ctx.fillStyle = C.park;
    ctx.fill(cell);
    if (r() < 0.65) {
      ctx.fillStyle = C.river;
      ctx.beginPath();
      ctx.ellipse(d.cx + (r() - 0.5) * d.r * 0.6, d.cy + (r() - 0.5) * d.r * 0.6, d.r * (0.14 + r() * 0.14), d.r * (0.09 + r() * 0.1), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // A couple of winding park drives.
    ctx.strokeStyle = C.street;
    ctx.lineWidth = local;
    for (let i = 0; i < 2; i++) {
      const a = r() * Math.PI * 2;
      const b = a + Math.PI * (0.6 + r() * 0.8);
      ctx.beginPath();
      ctx.moveTo(d.cx + Math.cos(a) * d.r, d.cy + Math.sin(a) * d.r);
      ctx.quadraticCurveTo(d.cx + (r() - 0.5) * d.r, d.cy + (r() - 0.5) * d.r, d.cx + Math.cos(b) * d.r, d.cy + Math.sin(b) * d.r);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  ctx.translate(d.cx, d.cy);
  ctx.rotate(d.angle);
  const R = d.r + 1;
  const ox = (r() - 0.5) * d.sx;
  const oy = (r() - 0.5) * d.sy;
  const nx = Math.ceil(R / d.sx) + 1;
  const ny = Math.ceil(R / d.sy) + 1;

  // Pocket parks, and darker yards in industrial areas.
  const lots = Math.round((nx * ny * 4) * (d.kind === "industrial" ? 0.22 : 0.035));
  ctx.fillStyle = d.kind === "industrial" ? C.urbanDark : C.park;
  for (let i = 0; i < lots; i++) {
    const bx = Math.floor((r() * 2 - 1) * nx);
    const by = Math.floor((r() * 2 - 1) * ny);
    ctx.fillRect(ox + bx * d.sx, oy + by * d.sy, d.sx, d.sy);
  }

  // Canal estates: a finger canal down the middle of every long block.
  if (d.kind === "canal") {
    ctx.strokeStyle = C.river;
    ctx.lineWidth = Math.min(0.5, d.sy * 0.16);
    ctx.lineCap = "butt";
    ctx.beginPath();
    for (let j = -ny; j <= ny; j++) {
      const y = oy + (j + 0.5) * d.sy;
      ctx.moveTo(-R, y);
      ctx.lineTo(R, y);
    }
    ctx.stroke();
  }

  // The street grid.
  const streets = new Path2D();
  for (let i = -nx; i <= nx; i++) {
    streets.moveTo(ox + i * d.sx, -R);
    streets.lineTo(ox + i * d.sx, R);
  }
  for (let j = -ny; j <= ny; j++) {
    streets.moveTo(-R, oy + j * d.sy);
    streets.lineTo(R, oy + j * d.sy);
  }
  ctx.strokeStyle = C.street;
  ctx.lineWidth = local;
  ctx.stroke(streets);

  // Lake neighbourhoods: ponds with a loop road around each.
  if (d.kind === "lake") {
    const ponds = 1 + Math.floor(r() * 2.4);
    for (let i = 0; i < ponds; i++) {
      const px = (r() - 0.5) * d.r * 0.9;
      const py = (r() - 0.5) * d.r * 0.9;
      const rx = d.r * (0.14 + r() * 0.16);
      const ry = rx * (0.55 + r() * 0.45);
      const rot = r() * Math.PI;
      ctx.beginPath();
      ctx.ellipse(px, py, rx + local * 2.2, ry + local * 2.2, rot, 0, Math.PI * 2);
      ctx.fillStyle = C.urban;
      ctx.fill();
      ctx.strokeStyle = C.street;
      ctx.lineWidth = local;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      ctx.fillStyle = C.river;
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Returns true if the town is (at least partly) in view and was painted. */
function paintTown(p: Painter, area: UrbanArea): boolean {
  const { ctx } = p;
  const xs = area.poly.map((q) => q[0]);
  const ys = area.poly.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (!inView(p, (x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0))) return false;
  const outline = polyPath2D(area.poly, true);

  ctx.save();
  ctx.clip(outline);
  ctx.fillStyle = C.urban;
  ctx.fill(outline);

  const plan = streetPlan(area);
  const arterials = new Path2D();
  for (const d of plan) {
    paintDistrict(p, d);
    if (inView(p, d.cx, d.cy, d.r)) arterials.addPath(polyPath2D(d.poly));
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // District edges are collector roads; long avenues run right across town.
  strokeRoad(p, arterials, 0.34, 0);
  const avenues = new Path2D();
  const r = seeded(area.seed * 53 + 7);
  const gap = Math.max(4.5, area.street * 4.4);
  for (let x = x0 + gap * (0.25 + r() * 0.5); x < x1; x += gap * (0.8 + r() * 0.55)) {
    const tilt = (r() - 0.5) * 0.14 * (y1 - y0);
    avenues.moveTo(x - tilt, y0);
    avenues.lineTo(x + tilt, y1);
  }
  for (let y = y0 + gap * (0.25 + r() * 0.5); y < y1; y += gap * (0.8 + r() * 0.55)) {
    const tilt = (r() - 0.5) * 0.14 * (x1 - x0);
    avenues.moveTo(x0, y - tilt);
    avenues.lineTo(x1, y + tilt);
  }
  strokeRoad(p, avenues, 0.56, 0.7);
  ctx.restore();

  ctx.strokeStyle = C.urbanEdge;
  ctx.lineWidth = Math.max(0.3, 0.8 / p.ppu);
  ctx.stroke(outline);
  return true;
}

/**
 * Towns are painted on their own canvas, cut to dry land (minus lakes, ponds and rivers)
 * and then laid over the map, so streets never run across water.
 */
function paintTowns(p: Painter) {
  const { ctx, view, ppu } = p;
  const layer = canvas(ctx.canvas.width, ctx.canvas.height);
  const t = layer.getContext("2d")!;
  t.setTransform(ppu, 0, 0, ppu, -view.x * ppu, -view.y * ppu);
  const painter: Painter = { ...p, ctx: t };
  let any = false;
  for (const area of URBAN_AREAS) any = paintTown(painter, area) || any;
  if (!any) return;

  const S = shapes();
  t.globalCompositeOperation = "destination-in";
  t.fill(S.land);
  t.globalCompositeOperation = "destination-out";
  t.fill(S.inland);
  strokeWaterways(t, () => true);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function paintAirports(p: Painter) {
  const { ctx } = p;
  for (const [lat, lon, len, angle] of AIRPORTS) {
    const [x, y] = geo(lat, lon);
    if (!inView(p, x, y, len * 2)) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.fillStyle = C.apron;
    ctx.fillRect(-len * 0.65, -len * 0.4, len * 1.3, len * 0.8);
    ctx.fillStyle = C.runway;
    ctx.fillRect(-len / 2, -len * 0.2, len, Math.max(0.5, len * 0.07));
    ctx.fillRect(-len / 2, len * 0.14, len, Math.max(0.5, len * 0.07));
    ctx.restore();
  }
}

/** Piers and marina docks reaching out over the water. */
function paintPiers(p: Painter) {
  const { ctx } = p;
  ctx.lineCap = "butt";
  for (const [lat, lon, heading, len, fingers] of PIERS) {
    const [x, y] = geo(lat, lon);
    if (!inView(p, x, y, len * 2)) continue;
    const path = new Path2D();
    path.moveTo(-0.3, 0);
    path.lineTo(len, 0);
    for (let i = 0; i < fingers; i++) {
      const fx = (len * (i + 1.2)) / (fingers + 0.6);
      path.moveTo(fx, -0.75);
      path.lineTo(fx, 0.75);
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((heading * Math.PI) / 180);
    ctx.strokeStyle = C.casing;
    ctx.lineWidth = fingers ? 0.3 : 0.42;
    ctx.stroke(path);
    ctx.strokeStyle = fingers ? C.urban : "#e9e4d4";
    ctx.lineWidth = fingers ? 0.2 : 0.3;
    ctx.stroke(path);
    ctx.restore();
  }
}

/* -------------------------------------------------------------------- roads */

/** County roads, section roads and forest tracks: on dry land only. */
function paintMinorRoads(p: Painter) {
  const { ctx } = p;
  const net = roadNetwork();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.save();
  ctx.clip(shapes().land);
  strokeRoad(p, net.tracks, 0.3, 0.5);
  strokeRoad(p, net.rural, 0.35, 0.6);
  strokeRoad(p, net.county, 0.6, 0.8);
  ctx.restore();
}

/** Highways and main roads, drawn last so they bridge rivers, lakes and bays. */
function paintMajorRoads(p: Painter) {
  const { ctx } = p;
  const k = p.roadScale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of ROADS) strokeRoad(p, d, 0.9 * k, 1.1);
  for (const d of CAUSEWAYS) strokeRoad(p, d, 0.8 * k, 1.1);
  strokeRoad(p, OVERSEAS_HIGHWAY, 0.9 * k, 1.1);
  for (const d of HIGHWAYS) strokeRoad(p, d, 1.5 * k, 1.6);
}

/* ------------------------------------------------------------------ labels */

function cssFont(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

function drawLabel(ctx: CanvasRenderingContext2D, label: MapLabel, fonts: { display: string; body: string }) {
  const size = label.size;
  ctx.save();
  ctx.translate(label.x, label.y);
  if (label.rotate) ctx.rotate((label.rotate * Math.PI) / 180);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      `${(label.kind === "region" ? 0.12 : 0.2) * size}px`;
  }
  if (label.kind === "region") {
    ctx.font = `400 ${size}px ${fonts.display}`;
    ctx.lineWidth = size * 0.14;
    ctx.strokeStyle = "rgba(25, 30, 25, 0.75)";
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.text, 0, 0);
  } else if (label.kind === "district") {
    ctx.font = `800 ${size}px ${fonts.body}`;
    ctx.lineWidth = size * 0.26;
    ctx.strokeStyle = "rgba(25, 30, 25, 0.7)";
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.text, 0, 0);
  } else {
    ctx.font = `italic 700 ${size}px ${fonts.body}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fillText(label.text, 0, 0);
  }
  ctx.restore();
}

async function paintLabels(p: Painter) {
  const { ctx } = p;
  ctx.save();
  ctx.clip(shapes().land);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1.1;
  ctx.setLineDash([6, 4]);
  for (const d of REGION_BOUNDARIES) ctx.stroke(new Path2D(d));
  ctx.restore();

  await document.fonts.ready;
  const fonts = {
    display: cssFont("--font-bebas", "Impact, sans-serif"),
    body: cssFont("--font-manrope", "Arial, sans-serif"),
  };
  for (const label of DISTRICT_LABELS) drawLabel(ctx, label, fonts);
  for (const region of REGIONS) {
    drawLabel(ctx, { text: region.name.toUpperCase(), x: region.label.x, y: region.label.y, size: 26, kind: "region" }, fonts);
  }
}

/* ------------------------------------------------------------------- layers */

async function paintLayer(view: MapView, ppu: number): Promise<HTMLCanvasElement> {
  const f = await getFields();
  const out = canvas(Math.round(view.w * ppu), Math.round(view.h * ppu));
  const ctx = out.getContext("2d")!;
  const p: Painter = { ctx, view, ppu, roadScale: ppu >= 8 ? 0.6 : ppu >= 4 ? 0.8 : 1 };
  ctx.setTransform(ppu, 0, 0, ppu, -view.x * ppu, -view.y * ppu);

  paintWater(p, f);
  paintLand(p, f);
  await yieldFrame();
  paintMinorRoads(p);
  paintInlandWater(p, f);
  await yieldFrame();
  paintTowns(p);
  paintAirports(p);
  paintBeaches(p);
  paintPiers(p);
  paintMajorRoads(p);
  await yieldFrame();
  await paintLabels(p);
  return out;
}

export interface MapLayer {
  canvas: HTMLCanvasElement;
  view: MapView;
  /** Base layer only: colour of the open sea at the texture edge. */
  edgeColor?: string;
}

function edgeColor(c: HTMLCanvasElement): string {
  const n = 16;
  const d = c.getContext("2d")!.getImageData(4, 4, n, n).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < n * n; i++) {
    r += d[i * 4];
    g += d[i * 4 + 1];
    b += d[i * 4 + 2];
  }
  return rgbString([r / (n * n), g / (n * n), b / (n * n)]);
}

const layerCache = new Map<string, Promise<MapLayer>>();

function cachedLayer(key: string, make: () => Promise<MapLayer>) {
  let hit = layerCache.get(key);
  if (!hit) {
    hit = make();
    hit.catch(() => layerCache.delete(key));
    layerCache.set(key, hit);
  }
  return hit;
}

/** The whole map at `heightPx` pixels tall (clamped by the caller to the GPU limit). */
export function renderBaseLayer(heightPx: number): Promise<MapLayer> {
  return cachedLayer(`base:${heightPx}`, async () => {
    const view = { x: A.x, y: A.y, w: A.w, h: A.h };
    const out = await paintLayer(view, heightPx / A.h);
    return { canvas: out, view, edgeColor: edgeColor(out) };
  });
}

/**
 * Higher-resolution region and city layers. `quality` scales the desktop resolution (0.5 on
 * phones); layers that would add little over the base map at that quality are skipped.
 */
export async function renderDetailLayers(maxTexture: number, quality: number): Promise<MapLayer[]> {
  const out: MapLayer[] = [];
  for (const v of DETAIL_VIEWS) {
    const ppu = Math.min(v.pxPerUnit * quality, maxTexture / Math.max(v.w, v.h));
    if (ppu < 3) continue;
    const view = { x: v.x, y: v.y, w: v.w, h: v.h };
    out.push(await cachedLayer(`${v.id}:${ppu.toFixed(2)}`, async () => ({ canvas: await paintLayer(view, ppu), view })));
    await yieldFrame();
  }
  return out;
}
