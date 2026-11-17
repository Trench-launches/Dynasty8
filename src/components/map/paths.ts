/**
 * Minimal SVG path sampler for the absolute M / L / C / S commands our map paths use.
 * Lets the city planner keep buildings off highways without touching the DOM.
 */

import type { Pt } from "./geometry";

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Polyline approximation of a path, roughly one point every `step` units. */
export function samplePath(d: string, step = 4): Pt[] {
  const tokens = d.match(/[MLCSZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Pt[] = [];
  let i = 0;
  let cmd = "";
  let cur: Pt = [0, 0];
  let lastCtrl: Pt | null = null;
  const num = () => parseFloat(tokens[i++]);
  const pt = (): Pt => [num(), num()];

  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "Z") continue;
    if (cmd === "M") {
      cur = pt();
      out.push(cur);
      lastCtrl = null;
      cmd = "L";
    } else if (cmd === "L") {
      const p = pt();
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - cur[0], p[1] - cur[1]) / step));
      for (let k = 1; k <= n; k++) out.push([cur[0] + ((p[0] - cur[0]) * k) / n, cur[1] + ((p[1] - cur[1]) * k) / n]);
      cur = p;
      lastCtrl = null;
    } else if (cmd === "C" || cmd === "S") {
      const c1: Pt =
        cmd === "C" ? pt() : lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
      const c2 = pt();
      const p = pt();
      const approx = Math.hypot(c1[0] - cur[0], c1[1] - cur[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p[0] - c2[0], p[1] - c2[1]);
      const n = Math.max(2, Math.ceil(approx / step));
      for (let k = 1; k <= n; k++) out.push(cubic(cur, c1, c2, p, k / n));
      cur = p;
      lastCtrl = c2;
    } else {
      i++; // unknown token: skip
    }
  }
  return out;
}

/** Distance from a point to a polyline. */
export function distToPolyline([x, y]: Pt, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}
