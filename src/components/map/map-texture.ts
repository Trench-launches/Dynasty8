/**
 * Paints Leonida as a flat, bright 2D atlas map: saturated blue sea with a cyan coastal glow,
 * flat greens on land, light-grey cities with a white street grid, white roads and a faint grid.
 * Original artwork generated from our own geometry (see geometry.ts), never traced from a game map.
 *
 * Pipeline
 * 1. Low-res "fields" for the whole map (computed once): water colour from a coastline
 *    distance field, land colour from soft biome masks + gentle noise.
 * 2. `paintLayer` draws a view of the map at any resolution: fields, coast, beaches, farms,
 *    wetlands, the city plan (streets, blocks, footprints, parks), roads, bridges and labels.
 *    The base layer covers the whole map; detail layers re-render Vice City at high
 *    resolution so close zooms stay sharp.
 */

import { REGIONS } from "@/data/regions";
import {
  AMBROSIA_FARMS,
  BARRIER_ISLANDS,
  BAY_ISLANDS,
  BEACH_ZONES,
  CAUSEWAYS,
  DETAIL_VIEWS,
  DISTRICT_LABELS,
  GRASSRIVERS_WETLAND,
  HARBOUR,
  HIGHWAYS,
  KALAGA_FOREST,
  KEYS,
  LAKE,
  MAINLAND,
  OCEAN_BEACH_ISLAND,
  OVERSEAS_HIGHWAY,
  REGION_BOUNDARIES,
  RIVERS,
  ROADS,
  RUNWAYS,
  TEXTURE_AREA,
  URBAN_AREAS,
  WATER_BANKS,
  inIslet,
  onLand,
  pointInPolygon,
  type Islet,
  type MapLabel,
  type MapView,
  type Pt,
} from "./geometry";
import { cityPlan, type Cell, type Rect } from "./city-plan";
import { blurField, distanceField, fbm, hex, ramp, rgbString, rng, smoothstep, type RGB } from "./noise";

export const MAP_COLORS = {
  /** Open ocean — also the fallback colour of the endless sea plane beyond the texture. */
  ocean: "#2966ae",
} as const;

const A = TEXTURE_AREA;
/** Map units per pixel of the low-res fields. */
const FIELD_RES = 2;

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
  [0, hex("#b8eff3")],
  [1.5, hex("#90e2ef")],
  [5, hex("#63cdea")],
  [12, hex("#46b2e2")],
  [24, hex("#3a97d6")],
  [45, hex("#3181c9")],
  [80, hex("#2c71bb")],
  [140, hex(MAP_COLORS.ocean)],
]);

const lakeRamp = ramp([
  [0, hex("#9fdcef")],
  [3, hex("#55b3e3")],
  [12, hex("#3b95d7")],
  [40, hex("#3385cd")],
]);

const LAND = {
  base: hex("#b7d46c"),
  alt: hex("#a9cc62"),
  light: hex("#c6dd80"),
  farm: hex("#cdd88b"),
  wet: hex("#9bc760"),
  wetDark: hex("#70aa52"),
  forest: hex("#70ad50"),
  forestDark: hex("#5e9f47"),
  urban: hex("#c6c6cc"),
  mangrove: hex("#5f9f4c"),
};

const C = {
  street: "#f4f4f6",
  block: "#b9bac3",
  blockResidential: "#c6c7cf",
  footprint: "#a6a8b3",
  park: "#94c75f",
  parking: "#bdbdc4",
  plaza: "#d7d7dd",
  verge: "#a9cd64",
  sand: "#efe7b6",
  road: "#ffffff",
  roadCasing: "#8f8f99",
  runway: "#8b8b94",
  river: "#3f9bd9",
};

/* ------------------------------------------------------------------ shapes */

function ellipsePath(e: Islet, scale = 1): Path2D {
  const p = new Path2D();
  p.ellipse(e.cx, e.cy, e.rx * scale, e.ry * scale, (e.rotate * Math.PI) / 180, 0, Math.PI * 2);
  return p;
}

function polyPath2D(pts: Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

interface Shapes {
  land: Path2D;
  inland: Path2D;
  /** Everything except land (use with the "evenodd" rule). */
  notLand: Path2D;
  lake: Path2D;
  highways: Path2D[];
  roads: Path2D[];
  bridges: Path2D[];
  rivers: Path2D[];
}

let shapeCache: Shapes | null = null;
function shapes(): Shapes {
  if (shapeCache) return shapeCache;
  const land = new Path2D();
  land.addPath(new Path2D(MAINLAND));
  land.addPath(new Path2D(OCEAN_BEACH_ISLAND));
  for (const e of [...BARRIER_ISLANDS, ...BAY_ISLANDS, ...KEYS]) land.addPath(ellipsePath(e));
  const inland = new Path2D();
  inland.addPath(ellipsePath(LAKE));
  inland.addPath(ellipsePath(HARBOUR));
  const notLand = new Path2D();
  notLand.rect(A.x - 2000, A.y - 2000, A.w + 4000, A.h + 4000);
  notLand.addPath(land);
  shapeCache = {
    land,
    inland,
    notLand,
    lake: ellipsePath(LAKE),
    highways: HIGHWAYS.map((d) => new Path2D(d)),
    roads: ROADS.map((d) => new Path2D(d)),
    bridges: [...CAUSEWAYS, OVERSEAS_HIGHWAY].map((d) => new Path2D(d)),
    rivers: RIVERS.map((d) => new Path2D(d)),
  };
  return shapeCache;
}

/* ------------------------------------------------------------------ fields */

interface Fields {
  water: HTMLCanvasElement;
  land: HTMLCanvasElement;
  w: number;
  h: number;
  wet: Float32Array;
  farm: Float32Array;
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

/** 0..1: how much a point sits on a shallow sand bank (stays turquoise far from shore). */
function bankWeight(x: number, y: number): number {
  let best = 0;
  for (const e of BANKS) {
    const dx = x - e.cx;
    const dy = y - e.cy;
    if (dx > e.reach || dx < -e.reach || dy > e.reach || dy < -e.reach) continue;
    const u = (dx * e.cos - dy * e.sin) / e.rx;
    const v = (dx * e.sin + dy * e.cos) / e.ry;
    const d = Math.sqrt(u * u + v * v);
    if (d < 1) best = Math.max(best, 1 - smoothstep(0.5, 1, d));
  }
  return best;
}

/** In-place colour mix: c = mix(c, b, t). Avoids allocating in the per-pixel loop. */
function mixInto(c: RGB, b: RGB, t: number) {
  c[0] += (b[0] - c[0]) * t;
  c[1] += (b[1] - c[1]) * t;
  c[2] += (b[2] - c[2]) * t;
}

/**
 * Low-frequency noise sampled on a coarse grid (every `step` field pixels) and bilinearly
 * interpolated — the same look for a fraction of the cost.
 */
function coarseNoise(w: number, h: number, step: number, sample: (mx: number, my: number) => number): Float32Array {
  const cw = Math.ceil(w / step) + 2;
  const ch = Math.ceil(h / step) + 2;
  const grid = new Float32Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      grid[cy * cw + cx] = sample(A.x + (cx * step + 0.5) * FIELD_RES, A.y + (cy * step + 0.5) * FIELD_RES);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = y / step;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = x / step;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const k = y0 * cw + x0;
      const a = grid[k];
      const b = grid[k + 1];
      const c = grid[k + cw];
      const d = grid[k + cw + 1];
      out[y * w + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

/** Only pixels this close (map units) to the coast need both a land and a water colour. */
const COAST_BAND = 8;

async function computeFields(): Promise<Fields> {
  const w = Math.ceil(A.w / FIELD_RES);
  const h = Math.ceil(A.h / FIELD_RES);
  const S = shapes();

  const landM = rasterMask(w, h, (ctx) => {
    ctx.fill(S.land);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill(S.inland);
  });
  const lakeM = rasterMask(w, h, (ctx) => ctx.fill(S.lake));
  const forestM = rasterMask(w, h, (ctx) => ctx.fill(polyPath2D(KALAGA_FOREST)));
  const wetM = rasterMask(w, h, (ctx) => ctx.fill(polyPath2D(GRASSRIVERS_WETLAND)));
  const farmM = rasterMask(w, h, (ctx) => ctx.fill(polyPath2D(AMBROSIA_FARMS)));
  const urbanM = rasterMask(w, h, (ctx) => URBAN_AREAS.forEach((a) => ctx.fill(polyPath2D(a.poly))));
  blurField(forestM, w, h, 10);
  blurField(wetM, w, h, 10);
  blurField(farmM, w, h, 8);
  blurField(urbanM, w, h, 3);
  await yieldFrame();

  const isLand = (i: number) => landM[i] > 0.5;
  const dOut = distanceField(w, h, isLand);
  const dIn = distanceField(w, h, (i) => !isLand(i));

  // Slow-varying noise: colour variation and the warp that gives biome edges an organic outline.
  const N1 = coarseNoise(w, h, 4, (mx, my) => fbm(mx * 0.006, my * 0.006, 3, 11));
  const WX = coarseNoise(w, h, 4, (mx, my) => (fbm(mx * 0.006, my * 0.006, 3, 31) - 0.5) * 70);
  const WY = coarseNoise(w, h, 4, (mx, my) => (fbm(mx * 0.006, my * 0.006, 3, 37) - 0.5) * 70);
  await yieldFrame();

  const water = new ImageData(w, h);
  const land = new ImageData(w, h);
  const idx = (x: number, y: number) =>
    Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)));
  const lc: RGB = [0, 0, 0];
  const wet: RGB = [0, 0, 0];
  const forest: RGB = [0, 0, 0];
  const interiorWater = oceanRamp(0);

  for (let y = 0; y < h; y++) {
    if (y % 120 === 0) await yieldFrame();
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const mx = A.x + (x + 0.5) * FIELD_RES;
      const my = A.y + (y + 0.5) * FIELD_RES;
      const onLandPx = landM[i] > 0.5;
      const dist = dOut[i] * FIELD_RES;
      const din = dIn[i] * FIELD_RES;
      const n1 = N1[i];

      /* water: open sea, lakes, and a band under the coast so the clipped coastline has no fringe */
      let wc: RGB = interiorWater;
      if (!onLandPx || din < COAST_BAND) {
        if (lakeM[i] > 0.5) {
          wc = lakeRamp(dist);
        } else {
          let depth = dist * (0.75 + 0.5 * n1);
          const bank = bankWeight(mx, my);
          if (bank > 0) depth = depth * (1 - bank) + Math.min(depth, 2 + 8 * n1) * bank;
          const edge = Math.min(x, y, w - 1 - x, h - 1 - y) * FIELD_RES;
          depth = Math.max(depth, 160 * (1 - smoothstep(0, 70, edge)));
          wc = oceanRamp(depth);
        }
      }
      water.data[o] = wc[0];
      water.data[o + 1] = wc[1];
      water.data[o + 2] = wc[2];
      water.data[o + 3] = 255;

      /* land: flat colours with soft biome blends */
      lc[0] = LAND.base[0];
      lc[1] = LAND.base[1];
      lc[2] = LAND.base[2];
      if (onLandPx || dist < COAST_BAND) {
        const j = idx(x + WX[i], y + WY[i]);
        const wF = forestM[j];
        const wW = wetM[j];
        const wA = farmM[j];
        const wU = urbanM[j];
        mixInto(lc, LAND.alt, n1 * 0.8);
        mixInto(lc, LAND.light, smoothstep(0.62, 0.8, n1) * 0.6);
        if (wA > 0.01) mixInto(lc, LAND.farm, wA * 0.8);
        if (wW > 0.01) {
          wet[0] = LAND.wet[0];
          wet[1] = LAND.wet[1];
          wet[2] = LAND.wet[2];
          mixInto(wet, LAND.wetDark, smoothstep(0.55, 0.62, fbm(mx * 0.03, my * 0.03, 2, 41)) * 0.8);
          mixInto(lc, wet, wW);
        }
        if (wF > 0.01) {
          forest[0] = LAND.forest[0];
          forest[1] = LAND.forest[1];
          forest[2] = LAND.forest[2];
          mixInto(forest, LAND.forestDark, smoothstep(0.5, 0.6, fbm(mx * 0.02, my * 0.02, 2, 43)));
          mixInto(lc, forest, wF);
        }
        if (wU > 0.01) mixInto(lc, LAND.urban, wU * 0.5);
        const mangroveCoast = (my > 740 && mx < 1015) || my > 1370 || (mx > 1030 && mx < 1062 && my > 980 && my < 1170);
        if (mangroveCoast && din < 6) mixInto(lc, LAND.mangrove, (1 - smoothstep(1, 4, din)) * 0.85);
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
  return { water: toCanvas(water), land: toCanvas(land), w, h, wet: wetM, farm: farmM };
}

let fieldsPromise: Promise<Fields> | null = null;
const getFields = () => (fieldsPromise ??= computeFields());

function sampleField(f: Fields, data: Float32Array, x: number, y: number) {
  const fx = Math.floor((x - A.x) / FIELD_RES);
  const fy = Math.floor((y - A.y) / FIELD_RES);
  if (fx < 0 || fy < 0 || fx >= f.w || fy >= f.h) return 0;
  return data[fy * f.w + fx];
}

/* ------------------------------------------------------------------ helpers */

interface Painter {
  ctx: CanvasRenderingContext2D;
  view: MapView;
  ppu: number;
  detail: boolean;
}

function inView(p: Painter, x: number, y: number, margin = 0) {
  const v = p.view;
  return x > v.x - margin && x < v.x + v.w + margin && y > v.y - margin && y < v.y + v.h + margin;
}

function rectInView(p: Painter, r: Rect, margin = 0) {
  const v = p.view;
  return r.x + r.w > v.x - margin && r.x < v.x + v.w + margin && r.y + r.h > v.y - margin && r.y < v.y + v.h + margin;
}

function fillRectRot(ctx: CanvasRenderingContext2D, f: Rect & { rot?: number }) {
  if (!f.rot) {
    ctx.fillRect(f.x, f.y, f.w, f.h);
    return;
  }
  ctx.save();
  ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
  ctx.rotate((f.rot * Math.PI) / 180);
  ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
  ctx.restore();
}

/* ---------------------------------------------------------- natural layers */

function paintWater(p: Painter, f: Fields) {
  const { ctx } = p;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(f.water, A.x, A.y, A.w, A.h);
  // Crisp light shoreline.
  ctx.save();
  ctx.clip(shapes().notLand, "evenodd");
  ctx.strokeStyle = "rgba(235,250,252,0.7)";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.1;
  ctx.stroke(shapes().land);
  ctx.restore();
}

function paintFarms(p: Painter, f: Fields) {
  const { ctx } = p;
  const r = rng(77);
  const colours = ["#cfd98c", "#c2d67b", "#d8d090", "#bcd475", "#d5dc9b", "#c8cf7f"];
  const xs = AMBROSIA_FARMS.map((q) => q[0]);
  const ys = AMBROSIA_FARMS.map((q) => q[1]);
  const size = 22;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 0.5;
  for (let y = Math.min(...ys); y < Math.max(...ys); y += size) {
    for (let x = Math.min(...xs); x < Math.max(...xs); x += size) {
      const roll = r();
      const strips = 1 + Math.floor(r() * 3);
      const cols = [r(), r(), r()];
      if (!inView(p, x, y, size)) continue;
      const cx = x + size / 2;
      const cy = y + size / 2;
      const wgt = sampleField(f, f.farm, cx, cy) + (cols[2] - 0.5) * 0.5;
      if (roll > 0.88 || wgt < 0.35 || !onLand([cx, cy]) || inIslet([cx, cy], LAKE, 1.1)) continue;
      if (URBAN_AREAS.some((a) => pointInPolygon([cx, cy], a.poly))) continue;
      ctx.globalAlpha = 0.85 * smoothstep(0.35, 0.8, wgt);
      for (let s = 0; s < strips; s++) {
        ctx.fillStyle = colours[Math.floor(cols[s] * colours.length)];
        ctx.fillRect(x, y + (s * size) / strips, size, size / strips);
      }
      ctx.strokeRect(x, y, size, size);
    }
  }
  ctx.globalAlpha = 1;
}

function paintWetlands(p: Painter, f: Fields) {
  const { ctx } = p;
  const xs = GRASSRIVERS_WETLAND.map((q) => q[0]);
  const ys = GRASSRIVERS_WETLAND.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];

  // Channels: slow, meandering streams running south-west.
  const r = rng(55);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#6cc0e4";
  for (let i = 0; i < 30; i++) {
    let x = x0 + r() * (x1 - x0);
    let y = y0 + r() * (y1 - y0) * 0.7;
    let heading = Math.PI / 2 + 0.35 + (r() - 0.5) * 0.4;
    const steps = 20 + Math.floor(r() * 50);
    const width = 0.7 + r() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < steps; s++) {
      heading += (r() - 0.5) * 0.55;
      heading += (Math.PI / 2 + 0.3 - heading) * 0.08;
      x += Math.cos(heading) * 3;
      y += Math.sin(heading) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineWidth = width;
    ctx.globalAlpha = 0.75 * smoothstep(0.3, 0.8, sampleField(f, f.wet, x, y));
    ctx.stroke();
  }
  // Hammocks: flat darker-green islands of trees.
  const t = rng(56);
  ctx.fillStyle = "#77ae55";
  for (let i = 0; i < 260; i++) {
    const x = x0 + t() * (x1 - x0);
    const y = y0 + t() * (y1 - y0);
    const rx = 1.5 + t() * 4;
    const ry = rx * (1.8 + t() * 1.6);
    if (!inView(p, x, y, 20)) continue;
    const wgt = sampleField(f, f.wet, x, y);
    if (wgt < 0.45 || !onLand([x, y])) continue;
    ctx.globalAlpha = 0.9 * smoothstep(0.45, 0.85, wgt);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintLand(p: Painter, f: Fields) {
  const { ctx } = p;
  const S = shapes();
  ctx.save();
  ctx.clip(S.land);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(f.land, A.x, A.y, A.w, A.h);
  paintFarms(p, f);
  paintWetlands(p, f);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = C.river;
  ctx.lineWidth = 2.4;
  for (const river of S.rivers) ctx.stroke(river);

  // Beaches.
  for (const zone of BEACH_ZONES) {
    ctx.save();
    ctx.clip(polyPath2D(zone));
    ctx.strokeStyle = C.sand;
    ctx.lineWidth = 3.4;
    ctx.stroke(S.land);
    ctx.restore();
  }
  ctx.restore();

  // Lakes and the harbour basin.
  ctx.save();
  ctx.clip(S.inland);
  ctx.drawImage(f.water, A.x, A.y, A.w, A.h);
  ctx.restore();
  ctx.strokeStyle = "rgba(235,250,252,0.7)";
  ctx.lineWidth = 0.9;
  ctx.stroke(S.lake);
}

/* -------------------------------------------------------------------- city */

function paintCellGround(p: Painter, c: Cell) {
  const { ctx } = p;
  const s = c.size;
  const block: Rect = { x: c.x + c.inset, y: c.y + c.inset, w: s - c.inset * 2, h: s - c.inset * 2 };
  ctx.fillStyle = C.street;
  ctx.fillRect(c.x - 0.05, c.y - 0.05, s + 0.1, s + 0.1);

  if (c.kind === "avenue") {
    if (c.avH !== c.avV) {
      ctx.fillStyle = C.verge;
      if (c.avV) ctx.fillRect(c.x + s / 2 - 0.5, c.y, 1, s);
      else ctx.fillRect(c.x, c.y + s / 2 - 0.5, s, 1);
    }
    return;
  }

  switch (c.kind) {
    case "verge":
      ctx.fillStyle = C.verge;
      break;
    case "park":
      ctx.fillStyle = C.park;
      break;
    case "parking":
      ctx.fillStyle = C.parking;
      break;
    case "plaza":
      ctx.fillStyle = C.plaza;
      break;
    default:
      ctx.fillStyle = c.lots.length ? C.blockResidential : C.block;
  }
  ctx.fillRect(block.x, block.y, block.w, block.h);
}

function paintAirport(p: Painter) {
  const { ctx } = p;
  const c: Pt = [873, 1174];
  const rot = -20;
  const a = (rot * Math.PI) / 180;
  if (!inView(p, c[0], c[1], 80)) return;
  const local = (x: number, y: number): Pt => {
    const dx = x - c[0];
    const dy = y - c[1];
    return [dx * Math.cos(-a) - dy * Math.sin(-a), dx * Math.sin(-a) + dy * Math.cos(-a)];
  };
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(a);
  ctx.fillStyle = C.verge;
  ctx.fillRect(-52, -29, 104, 58);
  ctx.fillStyle = C.plaza;
  ctx.fillRect(-48, 14.4, 70, 7.4);
  ctx.strokeStyle = "#b4b4bc";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-36, -9);
  ctx.lineTo(36, -9);
  ctx.moveTo(-32, 12.6);
  ctx.lineTo(32, 12.6);
  for (const u of [-30, 0, 28]) {
    ctx.moveTo(u, -14.9);
    ctx.lineTo(u, 14.6);
  }
  ctx.stroke();
  for (const [x, y, len, w, r] of RUNWAYS) {
    if (Math.hypot(x - c[0], y - c[1]) > 80) continue;
    const [u, v] = local(x, y);
    ctx.save();
    ctx.translate(u, v);
    ctx.rotate(((r - rot) * Math.PI) / 180);
    runway(ctx, len, w * 0.95, p.detail);
    ctx.restore();
  }
  ctx.restore();
}

function runway(ctx: CanvasRenderingContext2D, len: number, w: number, detail: boolean) {
  ctx.fillStyle = C.runway;
  ctx.fillRect(-len / 2, -w / 2, len, w);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  if (detail) for (let x = -len / 2 + 4; x < len / 2 - 4; x += 2.4) ctx.fillRect(x, -0.07, 1.3, 0.14);
  for (const end of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      ctx.fillRect(end * (len / 2 - 1.6) - 0.6, k * (w / 8) - 0.12, 1.2, 0.24);
    }
  }
}

function paintCity(p: Painter) {
  const plan = cityPlan();
  const cells = plan.cells.filter((c) => rectInView(p, { x: c.x, y: c.y, w: c.size, h: c.size }, 2));
  for (const c of cells) paintCellGround(p, c);
  paintAirport(p);
  // Building footprints, a shade darker than the blocks.
  p.ctx.fillStyle = C.footprint;
  for (const f of plan.footprints) {
    if (f.base > 0 || !rectInView(p, f, 1)) continue;
    fillRectRot(p.ctx, f);
  }
}

/* -------------------------------------------------------------------- roads */

function paintRoads(p: Painter) {
  const { ctx } = p;
  const S = shapes();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const road = (path: Path2D, width: number) => {
    ctx.strokeStyle = C.roadCasing;
    ctx.lineWidth = width + 0.7;
    ctx.stroke(path);
    ctx.strokeStyle = C.road;
    ctx.lineWidth = width;
    ctx.stroke(path);
  };
  for (const r of S.roads) road(r, 1.3);
  for (const hw of S.highways) road(hw, 2.8);
  for (const b of S.bridges) road(b, 2.4);

  // Regional airstrip at Port Gellhorn.
  for (const [x, y, len, w, r] of RUNWAYS) {
    if (Math.hypot(x - 873, y - 1174) < 80 || !inView(p, x, y, len)) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((r * Math.PI) / 180);
    ctx.fillStyle = C.verge;
    ctx.fillRect(-len / 2 - 4, -w * 2.5, len + 8, w * 5);
    runway(ctx, len, w, p.detail);
    ctx.restore();
  }
}

/* ------------------------------------------------------------- grid & labels */

function paintGrid(p: Painter) {
  const { ctx } = p;
  const step = 100;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let x = Math.ceil(p.view.x / step) * step; x < p.view.x + p.view.w; x += step) {
    ctx.moveTo(x, p.view.y);
    ctx.lineTo(x, p.view.y + p.view.h);
  }
  for (let y = Math.ceil(p.view.y / step) * step; y < p.view.y + p.view.h; y += step) {
    ctx.moveTo(p.view.x, y);
    ctx.lineTo(p.view.x + p.view.w, y);
  }
  ctx.stroke();
  ctx.restore();
}

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
    ctx.strokeStyle = "rgba(20, 22, 40, 0.8)";
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.text, 0, 0);
  } else if (label.kind === "district") {
    ctx.font = `800 ${size}px ${fonts.body}`;
    ctx.lineWidth = size * 0.26;
    ctx.strokeStyle = "rgba(20, 22, 40, 0.7)";
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.text, 0, 0);
  } else {
    ctx.font = `italic 700 ${size}px ${fonts.body}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(label.text, 0, 0);
  }
  ctx.restore();
}

async function paintLabels(p: Painter) {
  const { ctx } = p;
  ctx.save();
  ctx.clip(shapes().land);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([8, 6]);
  for (const d of REGION_BOUNDARIES) ctx.stroke(new Path2D(d));
  ctx.restore();

  await document.fonts.ready;
  const fonts = {
    display: cssFont("--font-bebas", "Impact, sans-serif"),
    body: cssFont("--font-manrope", "Arial, sans-serif"),
  };
  for (const label of DISTRICT_LABELS) drawLabel(ctx, label, fonts);
  for (const region of REGIONS) {
    drawLabel(ctx, { text: region.name.toUpperCase(), x: region.label.x, y: region.label.y, size: 40, kind: "region" }, fonts);
  }
}

/* ------------------------------------------------------------------- layers */

async function paintLayer(view: MapView, ppu: number, detail: boolean): Promise<HTMLCanvasElement> {
  const f = await getFields();
  const out = canvas(Math.round(view.w * ppu), Math.round(view.h * ppu));
  const ctx = out.getContext("2d")!;
  const p: Painter = { ctx, view, ppu, detail };
  ctx.setTransform(ppu, 0, 0, ppu, -view.x * ppu, -view.y * ppu);

  paintWater(p, f);
  paintLand(p, f);
  await yieldFrame();
  paintCity(p);
  paintRoads(p);
  paintGrid(p);
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
    const out = await paintLayer(view, heightPx / A.h, false);
    return { canvas: out, view, edgeColor: edgeColor(out) };
  });
}

/** High-resolution Vice City layers. `quality` scales the desktop resolution (0.5 on phones). */
export async function renderDetailLayers(maxTexture: number, quality: number): Promise<MapLayer[]> {
  const out: MapLayer[] = [];
  for (const v of DETAIL_VIEWS) {
    const ppu = Math.min(v.pxPerUnit * quality, maxTexture / Math.max(v.w, v.h));
    const view = { x: v.x, y: v.y, w: v.w, h: v.h };
    out.push(await cachedLayer(`${v.id}:${ppu.toFixed(2)}`, async () => ({ canvas: await paintLayer(view, ppu, true), view })));
  }
  return out;
}
