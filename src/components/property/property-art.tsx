"use client";

import { useId } from "react";
import type { PropertyArt as ArtSpec } from "@/data/types";
import { cn, seededRandom } from "@/lib/utils";

/**
 * Original generated property illustrations: a sunset scene plus a building
 * silhouette per style. Pure SVG, so it is sharp at any size and loads instantly.
 * Replace with photography/renders later by giving the property an image URL.
 */
export function PropertyArt({
  art,
  seed,
  className,
  title,
}: {
  art: ArtSpec;
  seed: string;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const id = (s: string) => `${uid}-${s}`;
  const rand = seededRandom(seed);
  const dark = "#1d1436";
  const mid = "#3a2763";

  /** Grid of windows, some lit. */
  const windows = (x: number, y: number, cols: number, rows: number, w: number, h: number, gx: number, gy: number) => {
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rand() > 0.45;
        out.push(
          <rect
            key={`${x}-${y}-${r}-${c}`}
            x={x + c * (w + gx)}
            y={y + r * (h + gy)}
            width={w}
            height={h}
            rx={0.6}
            fill={lit ? art.accent : "#2c1f4f"}
            opacity={lit ? 0.55 + rand() * 0.45 : 0.9}
          />,
        );
      }
    }
    return out;
  };

  const palm = (x: number, base: number, h: number, flip = 1) => (
    <g key={`palm-${x}`} transform={`translate(${x} ${base}) scale(${flip} 1)`} fill={dark}>
      <path d={`M0 0 C 3 ${-h * 0.4} 2 ${-h * 0.7} 8 ${-h}`} stroke={dark} strokeWidth={3} fill="none" strokeLinecap="round" />
      <g transform={`translate(8 ${-h})`}>
        <path d="M0 0 C -10 -8 -24 -6 -30 4 C -20 -2 -10 -1 0 0Z" />
        <path d="M0 0 C 10 -10 24 -8 30 2 C 20 -3 10 -2 0 0Z" />
        <path d="M0 0 C -4 -12 -14 -18 -24 -16 C -14 -12 -6 -6 0 0Z" />
        <path d="M0 0 C 6 -12 16 -18 26 -14 C 16 -11 7 -6 0 0Z" />
        <path d="M0 0 C -2 6 -10 14 -18 18 C -10 10 -5 5 0 0Z" />
        <path d="M0 0 C 4 6 12 13 20 16 C 12 9 6 5 0 0Z" />
      </g>
    </g>
  );

  const skyline = (y: number, opacity: number) => {
    const out = [];
    let x = -5;
    while (x < 405) {
      const w = 14 + rand() * 22;
      const h = 20 + rand() * 50;
      out.push(<rect key={`sky-${x}`} x={x} y={y - h} width={w} height={h + 60} fill={mid} opacity={opacity} />);
      x += w + 2;
    }
    return out;
  };

  const ground = (color: string) => <rect x={0} y={210} width={400} height={50} fill={color} />;

  let scene: React.ReactNode;
  switch (art.style) {
    case "twin-towers":
      scene = (
        <>
          {skyline(200, 0.55)}
          <path d="M138 212 V70 L170 54 V212Z" fill={dark} />
          <path d="M170 54 L182 62 V212 H170Z" fill={mid} />
          {windows(144, 76, 3, 16, 6, 4, 3, 4.5)}
          <path d="M214 212 V88 L246 72 V212Z" fill={dark} />
          <path d="M246 72 L258 80 V212 H246Z" fill={mid} />
          {windows(220, 94, 3, 14, 6, 4, 3, 4.5)}
          <rect x={120} y={196} width={160} height={16} fill={dark} />
          {ground("#24183f")}
          {palm(92, 214, 62)}
          {palm(305, 214, 70, -1)}
        </>
      );
      break;
    case "skyscraper":
      scene = (
        <>
          {skyline(200, 0.6)}
          <line x1={200} y1={8} x2={200} y2={34} stroke={dark} strokeWidth={2.5} />
          <circle cx={200} cy={8} r={2.4} fill="#ff4f6d" />
          <path d="M176 212 V48 L200 30 L224 48 V212Z" fill={dark} />
          <path d="M200 30 L224 48 V212 H200Z" fill={mid} opacity={0.7} />
          {windows(182, 56, 4, 24, 6, 3, 3, 3.5)}
          <path d="M120 212 V120 H160 V212Z" fill={dark} />
          {windows(126, 128, 3, 12, 7, 3, 4, 3.5)}
          <path d="M244 212 V138 H290 V212Z" fill={dark} />
          {windows(250, 146, 3, 10, 8, 3, 4, 3.5)}
          {ground("#1d1436")}
        </>
      );
      break;
    case "mansion":
      scene = (
        <>
          <path d="M0 170 C 80 140 160 160 220 150 S 340 140 400 160 V260 H0Z" fill={mid} opacity={0.65} />
          <path d="M90 150 L200 108 L310 150Z" fill={dark} />
          <rect x={100} y={150} width={200} height={56} fill={dark} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={118 + i * 30} y={156} width={4} height={50} fill={mid} />
          ))}
          {windows(126, 160, 6, 2, 12, 14, 18, 6)}
          <rect x={186} y={182} width={28} height={24} fill={art.accent} opacity={0.85} />
          {ground("#24183f")}
          <rect x={130} y={222} width={140} height={14} rx={7} fill="#5ad6e0" opacity={0.85} />
          <rect x={146} y={226} width={60} height={2} rx={1} fill="#fff" opacity={0.6} />
          {[40, 66, 334, 360].map((x) => (
            <ellipse key={x} cx={x} cy={204} rx={16} ry={12} fill="#2b1d4d" />
          ))}
          {palm(70, 214, 72)}
          {palm(330, 214, 66, -1)}
        </>
      );
      break;
    case "casino":
      scene = (
        <>
          {skyline(196, 0.45)}
          <rect x={60} y={140} width={280} height={72} fill={dark} />
          <path d="M150 212 V170 A50 50 0 0 1 250 170 V212Z" fill={art.accent} opacity={0.2} />
          <path d="M200 92 L222 116 L200 140 L178 116Z" fill={art.accent} />
          <path d="M200 98 L216 116 L200 134 L184 116Z" fill="#ff6b9d" />
          {Array.from({ length: 28 }).map((_, i) => (
            <circle key={i} cx={66 + i * 10} cy={146} r={1.6} fill={art.accent} opacity={i % 2 ? 1 : 0.5} />
          ))}
          {windows(72, 156, 6, 3, 8, 6, 6, 6)}
          {windows(260, 156, 5, 3, 8, 6, 6, 6)}
          {ground("#1d1436")}
          {palm(40, 214, 70)}
          {palm(366, 214, 64, -1)}
        </>
      );
      break;
    case "midrise":
      scene = (
        <>
          <rect x={0} y={190} width={400} height={30} fill="#5ad6e0" opacity={0.35} />
          <path d="M140 212 V80 H262 V212Z" fill={dark} />
          {Array.from({ length: 11 }).map((_, i) => (
            <rect key={i} x={136} y={92 + i * 11} width={130} height={2} fill={mid} />
          ))}
          {windows(148, 84, 8, 11, 9, 6, 5.5, 5)}
          {ground("#24183f")}
          {palm(100, 214, 76)}
          {palm(300, 214, 60, -1)}
        </>
      );
      break;
    case "hill-villa":
      scene = (
        <>
          <path d="M0 160 C 70 120 120 110 190 130 S 320 110 400 130 V260 H0Z" fill={mid} opacity={0.6} />
          <path d="M0 230 C 120 190 230 170 400 150 V260 H0Z" fill={dark} />
          <rect x={150} y={128} width={150} height={30} fill={dark} />
          <rect x={156} y={134} width={138} height={18} fill={art.accent} opacity={0.75} />
          <rect x={120} y={158} width={120} height={26} fill={dark} />
          <rect x={126} y={164} width={108} height={14} fill={art.accent} opacity={0.55} />
          <rect x={232} y={158} width={70} height={6} fill="#5ad6e0" />
          <path d="M200 184 L196 230 H206Z" fill={dark} />
          {palm(330, 170, 50, -1)}
        </>
      );
      break;
    case "beach-house":
      scene = (
        <>
          <rect x={0} y={178} width={400} height={40} fill="#4fc3d9" opacity={0.85} />
          {[186, 196, 206].map((y) => (
            <rect key={y} x={150 + (y % 20)} y={y} width={100 - (y - 186) * 2} height={1.5} fill="#fff3e8" opacity={0.6} />
          ))}
          <path d="M0 214 C 120 204 260 206 400 214 V260 H0Z" fill="#ffd9a8" />
          <rect x={120} y={156} width={110} height={56} fill="#ffb3c8" />
          <path d="M112 158 L175 122 L238 158Z" fill="#ff6b9d" />
          <rect x={136} y={172} width={22} height={18} fill={art.accent} />
          <rect x={192} y={172} width={22} height={18} fill={art.accent} />
          <rect x={164} y={186} width={22} height={26} fill="#7a3d6b" />
          <rect x={112} y={208} width={126} height={5} fill="#c98a6a" />
          {palm(60, 222, 84)}
          {palm(300, 222, 92, -1)}
          {palm(340, 224, 70)}
        </>
      );
      break;
    case "penthouse":
      scene = (
        <>
          {skyline(204, 0.7)}
          <rect x={164} y={58} width={84} height={160} fill={dark} />
          <rect x={160} y={42} width={92} height={18} fill={art.accent} opacity={0.9} />
          <rect x={168} y={46} width={76} height={2} fill="#fff" opacity={0.7} />
          {windows(172, 68, 5, 18, 8, 4, 6, 4)}
          {ground("#15152e")}
        </>
      );
      break;
    case "lofts":
      scene = (
        <>
          {skyline(190, 0.5)}
          <rect x={70} y={130} width={260} height={82} fill="#4a2a4a" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${92 + i * 48} 200 V160 a14 14 0 0 1 28 0 V200Z`}
              fill={rand() > 0.3 ? art.accent : "#2c1f4f"}
              opacity={0.85}
            />
          ))}
          <rect x={70} y={124} width={260} height={8} fill={dark} />
          <rect x={286} y={86} width={30} height={26} rx={4} fill={dark} />
          <path d="M290 112 L286 124 M312 112 L316 124" stroke={dark} strokeWidth={3} />
          {ground("#24183f")}
        </>
      );
      break;
    case "ranch":
      scene = (
        <>
          <path d="M0 180 L60 120 L110 160 L170 100 L240 170 L300 130 L400 176 V260 H0Z" fill={mid} opacity={0.55} />
          <path d="M0 206 C 130 196 260 198 400 206 V260 H0Z" fill="#e8956a" />
          <rect x={120} y={170} width={130} height={40} fill={dark} />
          <path d="M110 172 L185 146 L260 172Z" fill="#4a2a4a" />
          {windows(132, 182, 4, 1, 14, 12, 16, 0)}
          <line x1={310} y1={210} x2={310} y2={120} stroke={dark} strokeWidth={3} />
          <g transform="translate(310 118)" fill={dark}>
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <rect key={a} x={-1.5} y={-22} width={3} height={22} transform={`rotate(${a})`} />
            ))}
          </g>
          <path d="M60 210 V184 M60 196 H52 V188 M60 192 H68 V184" stroke={dark} strokeWidth={4} strokeLinecap="round" fill="none" />
        </>
      );
      break;
  }

  return (
    <svg
      viewBox="0 0 400 260"
      preserveAspectRatio="xMidYMid slice"
      className={cn("block h-full w-full", className)}
      role="img"
      aria-label={title ?? "Property illustration"}
    >
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={art.sky[0]} />
          <stop offset="0.55" stopColor={art.sky[1]} />
          <stop offset="1" stopColor={art.sky[2]} />
        </linearGradient>
        <linearGradient id={id("sun")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE6A8" />
          <stop offset="1" stopColor="#FF6B9D" />
        </linearGradient>
        <linearGradient id={id("fade")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.6" stopColor="#15152E" stopOpacity="0" />
          <stop offset="1" stopColor="#15152E" stopOpacity="0.45" />
        </linearGradient>
        <clipPath id={id("sunclip")}>
          <rect x="0" y="0" width="400" height="118" />
          {[124, 134, 146, 160].map((y, i) => (
            <rect key={y} x="0" y={y} width="400" height={5 + i * 1.5} />
          ))}
        </clipPath>
      </defs>
      <rect width="400" height="260" fill={`url(#${id("sky")})`} />
      <circle cx="250" cy="150" r="66" fill={`url(#${id("sun")})`} clipPath={`url(#${id("sunclip")})`} opacity="0.95" />
      {scene}
      <rect width="400" height="260" fill={`url(#${id("fade")})`} />
    </svg>
  );
}
