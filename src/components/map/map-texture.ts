/**
 * Paints the Leonida map (in the style of an in-game atlas map) into a canvas that
 * becomes the ground texture of the 3D scene.
 *
 * 1. Build an SVG string for TEXTURE_AREA (shapes, watercolour shallows, roads).
 * 2. Rasterise it into a canvas at the requested resolution.
 * 3. Draw labels with canvas text so they use the site's loaded web fonts.
 */

import { REGIONS } from "@/data/regions";
import {
  BARRIER_ISLANDS,
  BAY_ISLANDS,
  CAUSEWAYS,
  DISTRICT_LABELS,
  EAST_BEACH,
  GRASSRIVERS_WETLAND,
  HARBOUR,
  HIGHWAYS,
  KALAGA_FOREST,
  KEYS,
  LAKE,
  MAINLAND,
  OCEAN_BEACH_ISLAND,
  OCEAN_BEACH_SAND,
  OVERSEAS_HIGHWAY,
  REGION_BOUNDARIES,
  RIVERS,
  ROADS,
  RUNWAYS,
  TEXTURE_AREA,
  URBAN_AREAS,
  polyPath,
  seeded,
  urbanBlocks,
  type Islet,
  type MapLabel,
} from "./geometry";

export const MAP_COLORS = {
  ocean: "#1e5d9c",
  oceanLight: "#3f8ccb",
  shallows: "#86c8df",
  shallowsLight: "#c3e7ec",
  foam: "#eef8f4",
  turquoise: "#4fcabb",
  land: "#b7caa5",
  landDark: "#97b28a",
  wetland: "#a7c3a4",
  farm: "#d9d1ad",
  sand: "#ecd9a9",
  urban: "#8c889c",
  block: "#d9d6e2",
  blockAlt: "#c9c5d5",
  road: "#2f2f37",
  roadCasing: "#f4f2f7",
  minorRoad: "#56545f",
  inlandWater: "#4b97cc",
} as const;

const C = MAP_COLORS;

function islet(e: Islet, attrs: string) {
  return `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" transform="rotate(${e.rotate} ${e.cx} ${e.cy})" ${attrs}/>`;
}

function landShapes(attrs: string) {
  return [
    `<path d="${MAINLAND}" ${attrs}/>`,
    `<path d="${OCEAN_BEACH_ISLAND}" ${attrs}/>`,
    ...BARRIER_ISLANDS.map((e) => islet(e, attrs)),
    ...BAY_ISLANDS.map((e) => islet(e, attrs)),
    ...KEYS.map((e) => islet(e, attrs)),
  ].join("");
}

export function buildMapSvg(widthPx: number, heightPx: number): string {
  const A = TEXTURE_AREA;
  const r = seeded(99);
  const out: string[] = [];
  const push = (s: string) => out.push(s);

  push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="${A.x} ${A.y} ${A.w} ${A.h}">`,
  );
  push(`<defs>
    <filter id="b4" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="b10" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="b22" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="b45" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="45"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="7"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.55  0 0 0 0 0.36  0 0 0 0.9 -0.35"/>
    </filter>
    <clipPath id="land">${landShapes("")}</clipPath>
  </defs>`);

  // Ocean + watercolour variation
  push(`<rect x="${A.x - 50}" y="${A.y - 50}" width="${A.w + 100}" height="${A.h + 100}" fill="${C.ocean}"/>`);
  push(`<g filter="url(#b45)" fill="${C.oceanLight}">`);
  for (const [cx, cy, rx, ry, o] of [
    [100, 300, 160, 260, 0.35],
    [1220, 500, 120, 320, 0.3],
    [1180, 1250, 160, 200, 0.28],
    [120, 1150, 170, 230, 0.3],
    [600, 0, 380, 90, 0.25],
  ]) {
    push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" opacity="${o}"/>`);
  }
  push(`</g>`);
  // Turquoise bay & reef flats around the south tip and keys
  push(`<g filter="url(#b45)" fill="${C.turquoise}">
    <ellipse cx="640" cy="1410" rx="340" ry="115" opacity="0.6"/>
    <ellipse cx="960" cy="1300" rx="150" ry="70" opacity="0.35"/>
    <ellipse cx="1075" cy="1060" rx="60" ry="170" opacity="0.4"/>
  </g>`);

  // Shallows halo (blurred strokes around every coastline)
  push(`<g fill="none" stroke-linejoin="round">`);
  push(`<g filter="url(#b22)">${landShapes(`stroke="${C.shallows}" stroke-width="70" opacity="0.6"`)}</g>`);
  push(`<g filter="url(#b10)">${landShapes(`stroke="${C.shallowsLight}" stroke-width="30" opacity="0.75"`)}</g>`);
  push(`<g filter="url(#b4)">${landShapes(`stroke="${C.foam}" stroke-width="10" opacity="0.9"`)}</g>`);
  push(`</g>`);

  // Land
  push(landShapes(`fill="${C.land}"`));
  push(`<g clip-path="url(#land)">`);

  // Land use: forest, farmland, wetland — soft painted blotches
  push(`<path d="${polyPath(KALAGA_FOREST)}" fill="${C.landDark}" opacity="0.85" filter="url(#b22)"/>`);
  push(`<path d="${polyPath(GRASSRIVERS_WETLAND)}" fill="${C.wetland}" opacity="0.9" filter="url(#b22)"/>`);
  push(`<g filter="url(#b4)">`);
  for (let i = 0; i < 160; i++) {
    const x = 420 + r() * 470;
    const y = 740 + r() * 580;
    const light = r() > 0.5;
    push(
      `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(6 + r() * 20).toFixed(1)}" ry="${(4 + r() * 10).toFixed(1)}" fill="${light ? "#c8d8be" : "#8eac8a"}" opacity="0.45"/>`,
    );
  }
  for (let i = 0; i < 90; i++) {
    const x = 440 + r() * 460;
    const y = 110 + r() * 220;
    push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(4 + r() * 10).toFixed(1)}" fill="#86a57c" opacity="0.5"/>`,
    );
  }
  push(`</g>`);
  for (let i = 0; i < 70; i++) {
    const x = 440 + r() * 440;
    const y = 345 + r() * 380;
    const w = 18 + r() * 34;
    const h = 12 + r() * 22;
    push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" transform="rotate(${(r() * 8 - 4).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${C.farm}" opacity="${(0.35 + r() * 0.35).toFixed(2)}"/>`,
    );
  }
  push(`<rect x="${A.x}" y="${A.y}" width="${A.w}" height="${A.h}" filter="url(#grain)" opacity="0.28"/>`);

  // Inland water
  push(`<g fill="none" stroke="${C.inlandWater}" stroke-linecap="round">`);
  for (const d of RIVERS) push(`<path d="${d}" stroke-width="5"/>`);
  push(`</g>`);
  push(islet(LAKE, `fill="${C.inlandWater}" stroke="${C.shallowsLight}" stroke-width="5"`));
  push(islet(HARBOUR, `fill="${C.ocean}" stroke="${C.shallows}" stroke-width="5"`));

  // Region boundaries
  push(`<g fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.6" stroke-dasharray="8 6">`);
  for (const d of REGION_BOUNDARIES) push(`<path d="${d}"/>`);
  push(`</g>`);

  // Urban fabric: grey base with light blocks (streets read as the darker gaps)
  for (const area of URBAN_AREAS) {
    push(`<path d="${polyPath(area.poly)}" fill="${C.urban}" stroke="${C.urban}" stroke-width="6" stroke-linejoin="round"/>`);
  }
  for (const area of URBAN_AREAS) {
    for (const b of urbanBlocks(area)) {
      push(
        `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w.toFixed(1)}" height="${b.h.toFixed(1)}" fill="${b.tone > 0.55 ? C.block : C.blockAlt}"/>`,
      );
    }
  }

  // Airports
  for (const [x, y, len, w, rot] of RUNWAYS) {
    push(
      `<g transform="rotate(${rot} ${x} ${y})"><rect x="${x - len / 2}" y="${y - w / 2}" width="${len}" height="${w}" fill="#5d5a68"/><line x1="${x - len / 2 + 3}" y1="${y}" x2="${x + len / 2 - 3}" y2="${y}" stroke="#fff" stroke-width="0.7" stroke-dasharray="3 3"/></g>`,
    );
  }

  // Roads
  push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  for (const d of ROADS) push(`<path d="${d}" stroke="${C.minorRoad}" stroke-width="2"/>`);
  for (const d of HIGHWAYS) push(`<path d="${d}" stroke="${C.roadCasing}" stroke-width="7.5" opacity="0.8"/>`);
  for (const d of HIGHWAYS) push(`<path d="${d}" stroke="${C.road}" stroke-width="4.5"/>`);
  push(`</g>`);

  push(`</g>`); // end land clip

  // Beaches
  push(`<path d="${EAST_BEACH}" fill="none" stroke="${C.sand}" stroke-width="6" stroke-linecap="round"/>`);
  push(`<path d="${OCEAN_BEACH_SAND}" fill="none" stroke="${C.sand}" stroke-width="5" stroke-linecap="round"/>`);
  for (const e of BARRIER_ISLANDS) push(islet({ ...e, rx: e.rx * 0.45, cx: e.cx + e.rx * 0.5 }, `fill="${C.sand}"`));

  // Bridges & causeways over water
  push(`<g fill="none" stroke-linecap="round">`);
  for (const d of CAUSEWAYS) {
    push(`<path d="${d}" stroke="${C.roadCasing}" stroke-width="6"/>`);
    push(`<path d="${d}" stroke="${C.road}" stroke-width="3.5"/>`);
  }
  push(`<path d="${OVERSEAS_HIGHWAY}" stroke="${C.roadCasing}" stroke-width="5.5"/>`);
  push(`<path d="${OVERSEAS_HIGHWAY}" stroke="${C.road}" stroke-width="3"/>`);
  push(`</g>`);

  push(`</svg>`);
  return out.join("");
}

function cssFont(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

function drawLabel(ctx: CanvasRenderingContext2D, label: MapLabel, k: number, fonts: { display: string; body: string }) {
  const A = TEXTURE_AREA;
  const x = (label.x - A.x) * k;
  const y = (label.y - A.y) * k;
  const size = label.size * k;
  ctx.save();
  ctx.translate(x, y);
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
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = "rgba(18, 16, 28, 0.85)";
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.text, 0, 0);
  } else if (label.kind === "district") {
    ctx.font = `800 ${size}px ${fonts.body}`;
    ctx.lineWidth = size * 0.28;
    ctx.strokeStyle = "rgba(18, 16, 28, 0.75)";
    ctx.strokeText(label.text, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label.text, 0, 0);
  } else {
    ctx.font = `italic 700 ${size}px ${fonts.body}`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(label.text, 0, 0);
  }
  ctx.restore();
}

/** Renders the full map texture. `heightPx` is clamped by the caller to the GPU limit. */
export async function renderMapCanvas(heightPx: number): Promise<HTMLCanvasElement> {
  const A = TEXTURE_AREA;
  const k = heightPx / A.h;
  const width = Math.round(A.w * k);
  const height = Math.round(heightPx);

  const svg = buildMapSvg(width, height);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, width, height);

    await document.fonts.ready;
    const fonts = {
      display: cssFont("--font-bebas", "Impact, sans-serif"),
      body: cssFont("--font-manrope", "Arial, sans-serif"),
    };
    for (const label of DISTRICT_LABELS) drawLabel(ctx, label, k, fonts);
    for (const region of REGIONS) {
      drawLabel(ctx, { text: region.name.toUpperCase(), x: region.label.x, y: region.label.y, size: 40, kind: "region" }, k, fonts);
    }
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
