import { useId, type ReactNode } from "react";
import Image from "next/image";
import { bundledPropertyImage, cardImage } from "@/data/property-images";
import { cn } from "@/lib/utils";
import type { Property, PropertyCategory } from "@/lib/types";

/**
 * Generated sunset "postcard" illustration for a property. Used whenever the
 * backend has no image for a listing. Deterministic per slug.
 */

const SKIES = [
  ["#1d1640", "#7a3fd1", "#ff6b9d", "#ffb36b"],
  ["#15152e", "#30204f", "#ff8066", "#ffb36b"],
  ["#221a48", "#a45cff", "#ff6b9d", "#ff8066"],
  ["#15152e", "#4b2a7a", "#ff6b9d", "#ffd29b"],
];

const SILHOUETTE = "#1a1233";
const LIT = "#ffb36b";

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function windows(x: number, y: number, cols: number, rows: number, w: number, h: number, gx: number, gy: number, seed: number) {
  const out: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = (seed * (r + 3) * (c + 7)) % 5 > 1;
      out.push(
        <rect
          key={`${r}-${c}`}
          x={x + c * (w + gx)}
          y={y + r * (h + gy)}
          width={w}
          height={h}
          fill={lit ? LIT : "#2c2050"}
          opacity={lit ? 0.85 : 1}
        />,
      );
    }
  }
  return out;
}

function Palm({ x, h, flip = false }: { x: number; h: number; flip?: boolean }) {
  const top = 160 - h;
  const lean = flip ? -10 : 10;
  return (
    <g fill={SILHOUETTE} stroke={SILHOUETTE}>
      <path d={`M${x} 160 Q${x + lean * 0.4} ${160 - h / 2} ${x + lean} ${top}`} fill="none" strokeWidth={4} strokeLinecap="round" />
      {[-60, -25, 15, 50, 85, 130].map((a) => {
        const rad = (a * Math.PI) / 180;
        const len = 26;
        const ex = x + lean + Math.cos(rad) * len;
        const ey = top + Math.sin(rad) * len * 0.55 + 8;
        const cx = x + lean + Math.cos(rad) * len * 0.5;
        const cy = top - 10;
        return <path key={a} d={`M${x + lean} ${top} Q${cx} ${cy} ${ex} ${ey}`} fill="none" strokeWidth={3.2} strokeLinecap="round" />;
      })}
    </g>
  );
}

function Building({ category, seed }: { category: PropertyCategory; seed: number }) {
  switch (category) {
    case "motel":
      return (
        <g>
          <rect x={36} y={126} width={190} height={34} fill={SILHOUETTE} />
          <rect x={30} y={120} width={202} height={8} fill={SILHOUETTE} />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={44 + i * 23} y={136} width={9} height={24} fill={i % 3 === 1 ? LIT : "#2c2050"} />
          ))}
          <rect x={250} y={60} width={5} height={100} fill={SILHOUETTE} />
          <rect x={232} y={60} width={50} height={34} rx={4} fill={SILHOUETTE} stroke="#ff6b9d" strokeWidth={2} />
          <path d="M257 69 l3 7 7 0 -5.5 4.5 2 7 -6.5 -4 -6.5 4 2 -7 -5.5 -4.5 7 0 z" fill="#ff6b9d" />
        </g>
      );
    case "hotel":
      return (
        <g fill={SILHOUETTE}>
          <rect x={118} y={62} width={84} height={98} />
          <rect x={128} y={50} width={64} height={14} />
          <rect x={142} y={38} width={36} height={14} />
          <rect x={158} y={18} width={4} height={22} />
          <rect x={84} y={110} width={40} height={50} />
          <rect x={196} y={104} width={40} height={56} />
          <rect x={158} y={66} width={4} height={90} fill="#ff6b9d" opacity={0.9} />
          {windows(126, 72, 3, 8, 6, 5, 4, 5, seed)}
          {windows(166, 72, 3, 8, 6, 5, 4, 5, seed + 3)}
          {windows(90, 118, 3, 4, 6, 5, 4, 5, seed + 5)}
          {windows(202, 112, 3, 5, 6, 5, 4, 5, seed + 7)}
        </g>
      );
    case "garage":
    case "automotive":
    case "industrial":
      return (
        <g>
          <rect x={64} y={108} width={192} height={52} fill={SILHOUETTE} />
          <rect x={58} y={100} width={204} height={10} fill={SILHOUETTE} />
          <rect x={120} y={86} width={80} height={16} rx={3} fill={SILHOUETTE} stroke="#ff8066" strokeWidth={1.5} />
          {[78, 140, 202].map((x) => (
            <g key={x}>
              <rect x={x} y={122} width={42} height={38} fill="#2c2050" />
              {Array.from({ length: 6 }, (_, i) => (
                <rect key={i} x={x} y={124 + i * 6} width={42} height={2} fill={LIT} opacity={0.35} />
              ))}
            </g>
          ))}
        </g>
      );
    case "marina":
      return (
        <g>
          <rect x={40} y={150} width={240} height={6} fill={SILHOUETTE} />
          {[70, 140, 210].map((x, i) => (
            <g key={x} fill={SILHOUETTE}>
              <path d={`M${x - 26} 150 L${x + 26} 150 L${x + 18} 160 L${x - 18} 160 Z`} />
              <rect x={x - 1.5} y={70 + i * 8} width={3} height={80 - i * 8} />
              <path d={`M${x + 2} ${74 + i * 8} L${x + 2} 146 L${x + 30} 146 Z`} fill="#2c2050" />
              <path d={`M${x - 2} ${84 + i * 8} L${x - 2} 146 L${x - 22} 146 Z`} fill="#2c2050" />
            </g>
          ))}
          <rect x={250} y={112} width={44} height={40} fill={SILHOUETTE} />
          <path d="M246 112 L272 96 L298 112 Z" fill={SILHOUETTE} />
          <rect x={258} y={122} width={8} height={8} fill={LIT} />
          <rect x={276} y={122} width={8} height={8} fill={LIT} />
        </g>
      );
    case "apartment":
      return (
        <g fill={SILHOUETTE}>
          <rect x={86} y={70} width={150} height={90} />
          <rect x={80} y={64} width={162} height={8} />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={80} y={84 + i * 13} width={162} height={2.5} fill="#ff8066" opacity={0.5} />
          ))}
          {windows(94, 74, 9, 6, 9, 7, 6, 6, seed)}
        </g>
      );
    case "luxury":
      return (
        <g fill={SILHOUETTE}>
          <rect x={60} y={116} width={200} height={44} />
          <rect x={120} y={96} width={80} height={64} />
          <path d="M112 98 L160 70 L208 98 Z" />
          {[128, 144, 160, 176, 192].map((x) => (
            <rect key={x} x={x - 2} y={102} width={4} height={58} fill="#3b2a66" />
          ))}
          {windows(70, 124, 4, 2, 8, 9, 6, 8, seed)}
          {windows(212, 124, 4, 2, 8, 9, 6, 8, seed + 2)}
          <rect x={56} y={110} width={208} height={6} />
        </g>
      );
    case "offices":
      return (
        <g fill={SILHOUETTE}>
          <rect x={128} y={34} width={64} height={126} />
          <rect x={196} y={82} width={40} height={78} />
          <rect x={86} y={100} width={38} height={60} />
          <ellipse cx={160} cy={32} rx={26} ry={5} fill="#2c2050" stroke="#ffb36b" strokeWidth={1.5} />
          <text x={160} y={35} fontSize={7} textAnchor="middle" fill="#ffb36b" fontWeight={700}>
            H
          </text>
          {windows(134, 44, 5, 11, 7, 6, 4.5, 4.5, seed)}
          {windows(202, 90, 3, 6, 6, 6, 5, 5, seed + 4)}
          {windows(92, 108, 3, 5, 6, 6, 5, 5, seed + 9)}
        </g>
      );
    case "nightlife":
      return (
        <g>
          <path d="M120 112 L80 30 L100 30 Z" fill="#a45cff" opacity={0.25} />
          <path d="M200 112 L250 26 L232 24 Z" fill="#ff6b9d" opacity={0.25} />
          <rect x={86} y={112} width={150} height={48} fill={SILHOUETTE} />
          <rect x={110} y={92} width={102} height={22} rx={6} fill={SILHOUETTE} stroke="#a45cff" strokeWidth={2} />
          <path d="M120 103 q8 -8 16 0 t16 0 t16 0 t16 0 t16 0" fill="none" stroke="#ff6b9d" strokeWidth={2.5} />
          <rect x={146} y={132} width={30} height={28} fill="#ff6b9d" opacity={0.75} />
        </g>
      );
    case "house":
      return (
        <g fill={SILHOUETTE}>
          {[118, 146, 174, 202].map((x) => (
            <rect key={x} x={x} y={130} width={4} height={36} />
          ))}
          <rect x={106} y={128} width={110} height={5} />
          <rect x={114} y={98} width={94} height={32} />
          <path d="M104 100 L161 70 L218 100 Z" />
          <rect x={150} y={108} width={14} height={22} fill="#2c2050" />
          <rect x={124} y={106} width={16} height={12} fill={LIT} opacity={0.85} />
          <rect x={176} y={106} width={16} height={12} fill={LIT} opacity={0.85} />
          <rect x={216} y={128} width={70} height={4} />
          {[232, 256, 280].map((x) => (
            <rect key={x} x={x} y={130} width={3} height={30} />
          ))}
        </g>
      );
    case "studio":
      return (
        <g>
          <rect x={92} y={104} width={140} height={56} fill={SILHOUETTE} />
          <rect x={86} y={98} width={152} height={8} fill={SILHOUETTE} />
          <circle cx={162} cy={70} r={30} fill={SILHOUETTE} stroke="#ff6b9d" strokeWidth={2} />
          <circle cx={162} cy={70} r={20} fill="none" stroke="#3a2a60" strokeWidth={1.5} />
          <circle cx={162} cy={70} r={7} fill="#ff6b9d" />
          <rect x={104} y={120} width={30} height={12} fill={LIT} opacity={0.8} />
          <rect x={190} y={120} width={30} height={12} fill={LIT} opacity={0.8} />
          <rect x={148} y={128} width={28} height={32} fill="#2c2050" />
        </g>
      );
    case "safehouse":
    case "retail":
    default:
      return (
        <g fill={SILHOUETTE}>
          <rect x={108} y={116} width={104} height={44} />
          <path d="M98 118 L160 82 L222 118 Z" />
          <rect x={192} y={88} width={10} height={20} />
          <rect x={150} y={132} width={20} height={28} fill="#2c2050" />
          <rect x={120} y={126} width={18} height={14} fill={LIT} opacity={0.85} />
          <rect x={182} y={126} width={18} height={14} fill={LIT} opacity={0.85} />
        </g>
      );
  }
}

interface PropertyArtProps {
  property: Pick<Property, "slug" | "name" | "category" | "image">;
  className?: string;
  /** Rendered width hint for responsive image loading, e.g. "84px" or "(max-width: 1024px) 100vw, 380px". */
  sizes?: string;
  /** Load eagerly (above-the-fold hero images). */
  preload?: boolean;
  /** Load the original photo instead of the small card copy (the property page's hero). */
  full?: boolean;
}

/**
 * Property image. Uses the listing's photo when it has one, otherwise a generated
 * sunset illustration. `className` sizes the outer box in both cases.
 */
export function PropertyArt({
  property,
  className,
  sizes = "(max-width: 768px) 100vw, 400px",
  preload,
  full = false,
}: PropertyArtProps) {
  const id = useId().replace(/:/g, "");
  // A backend image wins; otherwise use the bundled photo for this slug (mock and DB mode).
  const original = property.image ?? bundledPropertyImage(property.slug);
  // Cards get the small copy; only the property page's hero photo loads the original.
  const src = original && !full ? cardImage(original) : original;
  if (src) {
    return (
      <div className={cn("relative overflow-hidden bg-white", className)}>
        <Image
          src={src}
          alt={property.name}
          fill
          sizes={sizes}
          preload={preload}
          className="object-cover"
        />
      </div>
    );
  }
  const seed = hash(property.slug);
  const sky = SKIES[seed % SKIES.length];
  const sunX = 70 + (seed % 180);
  const palmLeft = 26 + (seed % 30);
  const palmRight = 270 + (seed % 30);

  return (
    <svg
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Illustration of ${property.name}`}
      className={cn("block", className)}
    >
      <defs>
        <linearGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="0.45" stopColor={sky[1]} />
          <stop offset="0.75" stopColor={sky[2]} />
          <stop offset="1" stopColor={sky[3]} />
        </linearGradient>
        <linearGradient id={`sun-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="1" stopColor="#ff6b9d" />
        </linearGradient>
        <linearGradient id={`sea-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2470" />
          <stop offset="1" stopColor="#15152e" />
        </linearGradient>
        <mask id={`stripes-${id}`}>
          <rect width="320" height="200" fill="white" />
          {[104, 114, 123, 131, 138].map((y, i) => (
            <rect key={y} x={0} y={y} width={320} height={2 + i * 0.8} fill="black" />
          ))}
        </mask>
      </defs>
      <rect width="320" height="200" fill={`url(#sky-${id})`} />
      <circle cx={sunX} cy={124} r={56} fill={`url(#sun-${id})`} mask={`url(#stripes-${id})`} opacity={0.95} />
      <rect y={160} width="320" height="40" fill={`url(#sea-${id})`} />
      {[168, 176, 186].map((y, i) => (
        <rect key={y} x={sunX - 40 + i * 8} y={y} width={80 - i * 16} height={2} fill="#ff6b9d" opacity={0.5 - i * 0.12} />
      ))}
      <rect y={156} width="320" height="5" fill={SILHOUETTE} />
      <Building category={property.category} seed={seed} />
      <Palm x={palmLeft} h={88} />
      <Palm x={palmRight} h={74} flip />
    </svg>
  );
}
