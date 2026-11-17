import { memo, useMemo } from "react";
import { seededRandom } from "@/lib/utils";
import { MAP_H, MAP_W } from "./use-pan-zoom";

/**
 * Original stylised city: hills with contour lines and trails, a reservoir, desert,
 * two street grids, highways, a river, beach and ocean. Fictional geography.
 * Everything is vector, so it stays crisp at every zoom level.
 */

const HILL_EDGE =
  "M0 336 C 20 330 50 326 80 330 C 150 340 220 310 300 320 C 380 330 430 305 500 312 C 580 320 620 300 700 300 C 760 300 800 275 860 290 C 900 300 940 270 1000 250";
const COAST_R =
  "C 420 690 360 670 300 640 C 240 610 190 570 150 520 C 110 470 60 432 0 420";
const COAST = "M0 420 C 60 432 110 470 150 520 C 190 570 240 610 300 640 C 360 670 420 690 470 700";

const HILLS = `${HILL_EDGE} V0 H0 Z`;
const CITY = `${HILL_EDGE} V700 H470 ${COAST_R} Z`;
const OCEAN = `${COAST} H0 Z`;
const DESERT = "M790 0 H1000 V250 C 960 262 930 250 900 236 C 860 214 840 160 820 110 C 806 70 796 30 790 0 Z";
const LAKE =
  "M650 96 C 672 70 716 64 742 80 C 768 96 790 92 798 116 C 806 142 778 158 750 156 C 724 154 712 172 684 168 C 652 164 630 124 650 96 Z";

const HIGHWAYS = [
  "M1000 386 C 880 404 820 440 760 470 C 680 510 600 522 520 560 C 460 590 430 640 414 700",
  "M548 0 C 560 80 590 150 614 222 C 640 300 660 380 700 450 C 740 520 796 600 822 700",
  "M0 372 C 80 384 160 410 220 450 C 270 486 320 520 420 560 C 470 580 500 560 520 560",
];

const HILL_ROADS = [
  "M120 330 C 140 280 120 240 160 200 C 200 160 250 170 290 130 C 320 100 300 60 330 20",
  "M300 320 C 320 280 360 260 400 250 C 450 238 470 200 520 196 C 560 192 590 214 614 222",
  "M420 308 C 430 270 410 240 440 210 C 470 180 470 140 500 110 C 520 90 540 60 548 0",
  "M614 222 C 650 200 700 210 740 190 C 780 170 810 190 850 170 C 880 156 910 168 940 150",
  "M700 300 C 720 260 760 250 790 230 C 820 210 860 230 900 236",
  "M30 250 C 70 220 60 170 100 140 C 140 110 180 120 200 80 C 214 50 200 20 220 0",
];

const PEAKS = [
  { x: 210, y: 150, r: 110 },
  { x: 430, y: 120, r: 120 },
  { x: 560, y: 260, r: 70 },
  { x: 90, y: 60, r: 90 },
];

function blob(cx: number, cy: number, r: number, rand: () => number) {
  const a = rand() * Math.PI * 2;
  const b = rand() * Math.PI * 2;
  const pts: string[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const rr = r * (1 + 0.16 * Math.sin(3 * th + a) + 0.08 * Math.sin(5 * th + b));
    pts.push(`${(cx + rr * Math.cos(th)).toFixed(1)} ${(cy + rr * 0.8 * Math.sin(th)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

function gridLines(spacing: number, avenueEvery: number) {
  const thin: string[] = [];
  const thick: string[] = [];
  for (let v = -400; v <= 1400; v += spacing) {
    const i = Math.round(v / spacing);
    const target = i % avenueEvery === 0 ? thick : thin;
    target.push(`M${v} -400 V1100`, `M-400 ${v} H1400`);
  }
  return { thin: thin.join(" "), thick: thick.join(" ") };
}

const westGrid = gridLines(21, 4);
const eastGrid = gridLines(24, 4);

const contourRand = seededRandom("city-contours");
const CONTOUR_PATHS = PEAKS.flatMap((p) =>
  [1, 0.78, 0.58, 0.4, 0.24].map((f) => blob(p.x, p.y, p.r * f, contourRand)),
);

export const CityMapBase = memo(function CityMapBase({ k = 1 }: { k?: number }) {
  // Roads and labels grow slower than the map so close zooms stay readable.
  const s = (w: number) => w / Math.pow(k, 0.55);
  const fs = (size: number) => size / Math.pow(k, 0.7);
  const contours = useMemo(() => CONTOUR_PATHS.map((d, i) => <path key={i} d={d} />), []);

  return (
    <g>
      <defs>
        <linearGradient id="map-ocean" gradientUnits="userSpaceOnUse" x1="0" y1="380" x2="260" y2="980">
          <stop offset="0" stopColor="#58c6d8" />
          <stop offset="1" stopColor="#3a8fc0" />
        </linearGradient>
        <linearGradient id="map-hills" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f9a7e" />
          <stop offset="1" stopColor="#6db08f" />
        </linearGradient>
        <clipPath id="map-city-clip">
          <path d={CITY} />
        </clipPath>
        <clipPath id="map-west-clip">
          <rect x="0" y="0" width="560" height="700" />
        </clipPath>
        <clipPath id="map-east-clip">
          <rect x="560" y="0" width="440" height="700" />
        </clipPath>
        <pattern id="map-waves" width="40" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 9 Q 10 4 20 9 T 40 9" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1.2" />
        </pattern>
      </defs>

      {/* Ocean & land */}
      <rect x={-600} y={-600} width={MAP_W + 1200} height={MAP_H + 1200} fill="#e9e1ee" />
      {/* Artwork beyond the map edges, visible when panning past them */}
      <rect x={-600} y={-600} width={MAP_W + 1200} height={600} fill="#4f9a7e" />
      <rect x={-600} y={0} width={600} height={336} fill="#4f9a7e" />
      <rect x={MAP_W} y={0} width={600} height={250} fill="#efbd8f" />
      <path d="M-600 420 H0 V700 H470 V1300 H-600 Z" fill="url(#map-ocean)" />
      <path d="M-600 420 H0 V700 H470 V1300 H-600 Z" fill="url(#map-waves)" />
      <path d={OCEAN} fill="url(#map-ocean)" />
      <path d={OCEAN} fill="url(#map-waves)" />
      <path d={`${COAST}`} fill="none" stroke="#ffd9a8" strokeWidth={16} strokeLinecap="round" />
      <path d={`${COAST}`} fill="none" stroke="#fff3e8" strokeWidth={2} strokeOpacity={0.7} transform="translate(-6 6)" />

      {/* Hills */}
      <path d={HILLS} fill="url(#map-hills)" />
      <path d={DESERT} fill="#efbd8f" />
      <g fill="none" stroke="#8cc6a6" strokeWidth={s(1.4)} strokeOpacity={0.75}>
        {contours}
      </g>
      <g fill="none" stroke="#f6ead2" strokeWidth={s(2.4)} strokeLinecap="round" strokeOpacity={0.9}>
        {HILL_ROADS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path d={LAKE} fill="#4fc3d9" stroke="#e6fbff" strokeWidth={2} />

      {/* City */}
      <g clipPath="url(#map-city-clip)">
        <path d={CITY} fill="#e4dbe8" />
        <g clipPath="url(#map-west-clip)">
          <g transform="rotate(28 300 480)" fill="none" stroke="#ffffff">
            <path d={westGrid.thin} strokeWidth={s(2.2)} />
            <path d={westGrid.thick} strokeWidth={s(4.2)} />
          </g>
        </g>
        <g clipPath="url(#map-east-clip)">
          <g transform="rotate(-8 760 520)" fill="none" stroke="#ffffff">
            <path d={eastGrid.thin} strokeWidth={s(2.4)} />
            <path d={eastGrid.thick} strokeWidth={s(4.6)} />
          </g>
        </g>
        {/* Parks */}
        <ellipse cx={520} cy={420} rx={34} ry={22} fill="#8cc6a6" />
        <rect x={830} y={560} width={60} height={36} rx={6} fill="#8cc6a6" transform="rotate(-8 860 578)" />
        <ellipse cx={420} cy={470} rx={18} ry={14} fill="#8cc6a6" />
        <rect x={930} y={430} width={52} height={40} rx={20} fill="#f5c9a0" />
      </g>

      {/* River and canal */}
      <path
        d="M470 300 C 450 360 380 380 360 430 C 340 480 300 520 250 600"
        fill="none"
        stroke="#4fc3d9"
        strokeWidth={s(7)}
        strokeLinecap="round"
      />

      {/* Highways */}
      <g fill="none" strokeLinecap="round">
        {HIGHWAYS.map((d) => (
          <path key={`o-${d}`} d={d} stroke="#ff8066" strokeWidth={s(9)} />
        ))}
        {HIGHWAYS.map((d) => (
          <path key={`i-${d}`} d={d} stroke="#ffc58a" strokeWidth={s(5)} />
        ))}
      </g>

      {/* Pier */}
      <path d="M96 470 L36 520" stroke="#c98a6a" strokeWidth={6} strokeLinecap="round" />
      <circle cx={40} cy={517} r={7} fill="none" stroke="#ff6b9d" strokeWidth={2.5} />

      {/* Labels */}
      <g
        fontFamily="var(--font-anton), Impact, sans-serif"
        fontSize={fs(15)}
        letterSpacing={fs(3)}
        fill="#30204f"
        fillOpacity={0.5}
        textAnchor="middle"
        style={{ pointerEvents: "none" }}
      >
        <text x={470} y={240}>VINEWOOD HILLS</text>
        <text x={330} y={410}>ROCKFORD HILLS</text>
        <text x={110} y={390}>DEL PERRO</text>
        <text x={380} y={612}>VESPUCCI</text>
        <text x={610} y={590}>DOWNTOWN</text>
        <text x={780} y={452}>PILLBOX HILL</text>
        <text x={910} y={70}>SANDY SHORES</text>
        <text x={722} y={124} fontSize={fs(10)} fill="#ffffff" fillOpacity={0.9}>RESERVOIR</text>
        <text x={120} y={640} fontSize={fs(18)} fill="#ffffff" fillOpacity={0.55} fontStyle="italic">
          SUNSET BAY
        </text>
      </g>
    </g>
  );
});
