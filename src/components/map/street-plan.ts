/**
 * Street layout for the 2D road map. Each town is split into irregular districts (Voronoi
 * cells of jittered seed points). District borders become arterial roads; inside, every
 * district gets its own street grid angle and block size, or becomes a park, a lake
 * neighbourhood, a canal estate or an industrial area. Deterministic, original layouts.
 */

import { pointInPolygon, seeded, type Pt, type UrbanArea } from "./geometry";

export type DistrictKind = "grid" | "park" | "lake" | "canal" | "industrial";

export interface District {
  poly: Pt[];
  cx: number;
  cy: number;
  /** Radius of a circle around (cx, cy) that covers the district. */
  r: number;
  kind: DistrictKind;
  /** Street grid rotation in radians. */
  angle: number;
  /** Block size along and across the grid, in map units. */
  sx: number;
  sy: number;
  seed: number;
}

/** Clip a convex polygon to the half-plane of points closer to `a` than to `b`. */
function clipCloser(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const nx = b[0] - a[0];
  const ny = b[1] - a[1];
  const side = (p: Pt) => (p[0] - mx) * nx + (p[1] - my) * ny;
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if (sp <= 0 !== sq <= 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const KIND_ODDS: Record<UrbanArea["style"], [DistrictKind, number][]> = {
  downtown: [["grid", 0.8], ["park", 0.07], ["lake", 0.04], ["industrial", 0.09]],
  residential: [["grid", 0.62], ["lake", 0.17], ["park", 0.09], ["canal", 0.12]],
  resort: [["grid", 0.9], ["park", 0.1]],
  town: [["grid", 0.68], ["lake", 0.1], ["park", 0.1], ["industrial", 0.12]],
};

function pick(odds: [DistrictKind, number][], v: number): DistrictKind {
  let acc = 0;
  for (const [kind, p] of odds) {
    acc += p;
    if (v < acc) return kind;
  }
  return "grid";
}

const cache = new Map<string, District[]>();

export function streetPlan(area: UrbanArea): District[] {
  const hit = cache.get(area.id);
  if (hit) return hit;

  const xs = area.poly.map((p) => p[0]);
  const ys = area.poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const size = Math.min(x1 - x0, y1 - y0);
  // District size: big metros get ~9-unit districts, small towns a handful of small ones.
  const d = Math.max(2.5, Math.min(area.style === "resort" ? 5 : 9, size / 2.6));
  const r = seeded(area.seed * 977 + 13);

  const nx = Math.ceil((x1 - x0) / d) + 2;
  const ny = Math.ceil((y1 - y0) / d) + 2;
  const seeds: Pt[][] = [];
  for (let gy = 0; gy < ny; gy++) {
    const row: Pt[] = [];
    for (let gx = 0; gx < nx; gx++) {
      row.push([x0 + (gx - 0.5 + 0.15 + r() * 0.7) * d, y0 + (gy - 0.5 + 0.15 + r() * 0.7) * d]);
    }
    seeds.push(row);
  }

  const out: District[] = [];
  for (let gy = 0; gy < ny; gy++) {
    for (let gx = 0; gx < nx; gx++) {
      const s = seeds[gy][gx];
      // Roll every property up front so the layout does not depend on which cells survive.
      const kindRoll = r();
      const angleRoll = r();
      const angleAmount = r();
      const sxRoll = r();
      const syRoll = r();
      const seed = Math.floor(r() * 1e9);

      let poly: Pt[] = [
        [s[0] - 2 * d, s[1] - 2 * d],
        [s[0] + 2 * d, s[1] - 2 * d],
        [s[0] + 2 * d, s[1] + 2 * d],
        [s[0] - 2 * d, s[1] + 2 * d],
      ];
      for (let oy = -2; oy <= 2 && poly.length; oy++) {
        for (let ox = -2; ox <= 2 && poly.length; ox++) {
          if (!ox && !oy) continue;
          const other = seeds[gy + oy]?.[gx + ox];
          if (other) poly = clipCloser(poly, s, other);
        }
      }
      if (poly.length < 3) continue;
      if (!pointInPolygon(s, area.poly) && !poly.some((p) => pointInPolygon(p, area.poly))) continue;

      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
      const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const radius = Math.max(...poly.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
      const kind = pick(KIND_ODDS[area.style], kindRoll);

      let angle = 0;
      if (angleRoll > 0.52 && angleRoll <= 0.7) angle = (angleAmount - 0.5) * 0.7;
      else if (angleRoll > 0.7 && angleRoll <= 0.85) angle = Math.PI / 4 + (angleAmount - 0.5) * 0.25;
      else if (angleRoll > 0.85) angle = angleAmount * Math.PI * 0.5;
      if (area.style === "resort") angle = 0;

      const base = area.street;
      let sx = base * (0.8 + sxRoll * 0.45);
      let sy = base * (area.style === "downtown" || area.style === "resort" ? 0.8 + syRoll * 0.5 : 1.25 + syRoll * 1.1);
      if (kind === "industrial") {
        sx *= 2.1;
        sy *= 1.7;
      }
      if (kind === "canal") {
        sx = base * 1.15;
        sy = base * 3.2;
      }
      out.push({ poly, cx, cy, r: radius, kind, angle, sx, sy, seed });
    }
  }
  cache.set(area.id, out);
  return out;
}
