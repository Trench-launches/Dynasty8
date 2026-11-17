"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { TOKEN_STATUS_LABELS } from "@/data/regions";
import { formatUsdCompact, tickerLabel } from "@/lib/format";
import type { Property } from "@/lib/types";

/** House-shaped pin, origin at the tip. Shared with the legend. */
export const HOUSE_PATH = "M17 40 L12 33 H6 V19 H3.5 L17 6.5 L30.5 19 H28 V33 H22 Z";
const STAR =
  "M0 -5 L1.47 -1.55 L4.76 -1.55 L2.12 0.6 L2.94 4.05 L0 2.1 L-2.94 4.05 L-2.12 0.6 L-4.76 -1.55 L-1.47 -1.55 Z";

export type PinState = "default" | "hovered" | "selected";

export function pinColors(status: Property["token"]["status"], state: PinState) {
  if (state === "selected") return { fill: "#ff6b9d", stroke: "#ffffff", door: "#15152e", dashed: status === "unavailable" };
  if (status === "unavailable") return { fill: "#77718a", stroke: "#26222f", door: "#3d384a", dashed: true };
  if (status === "live") return { fill: "url(#pin-live)", stroke: state === "hovered" ? "#ff6b9d" : "#1a1220", door: "#ffffff", dashed: false };
  return { fill: "#ffffff", stroke: state === "hovered" ? "#ff6b9d" : "#1a1220", door: "#30204f", dashed: false };
}

export function PinGlyph({
  status,
  state,
  featured,
  className,
}: {
  status: Property["token"]["status"];
  state: PinState;
  featured: boolean;
  className?: string;
}) {
  const c = pinColors(status, state);
  return (
    <svg viewBox="0 0 34 42" className={cn("overflow-visible", className)} aria-hidden="true">
      <defs>
        <linearGradient id="pin-live" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb36b" />
          <stop offset="1" stopColor="#ff8066" />
        </linearGradient>
      </defs>
      <path
        d={HOUSE_PATH}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={state === "default" ? 2 : 2.6}
        strokeLinejoin="round"
        strokeDasharray={c.dashed ? "3.5 2.5" : undefined}
      />
      <rect x={14} y={24} width={6} height={9} rx={1} fill={c.door} />
      {status === "unavailable" && (
        <path d="M8 31 L26 13" stroke="#fff" strokeOpacity={0.85} strokeWidth={2.2} strokeLinecap="round" />
      )}
      {featured && (
        <g transform="translate(29 8)">
          <circle r={6.5} fill="#15152e" stroke="#ffb36b" strokeWidth={1.4} />
          <path d={STAR} fill="#ffb36b" transform="scale(0.95)" />
        </g>
      )}
    </svg>
  );
}

interface MapPinProps {
  property: Property;
  state: PinState;
  showLabel: boolean;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
}

export const MapPin = memo(function MapPin({ property, state, showLabel, onSelect, onHover }: MapPinProps) {
  const m = property.market;
  return (
    <div className="relative -translate-x-1/2 -translate-y-full select-none">
      <button
        type="button"
        aria-label={`${property.name} (${tickerLabel(property)}), ${TOKEN_STATUS_LABELS[property.token.status]}`}
        aria-pressed={state === "selected"}
        onClick={() => onSelect(property.slug)}
        onPointerEnter={() => onHover(property.slug)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(property.slug)}
        onBlur={() => onHover(null)}
        className={cn(
          "block origin-bottom cursor-pointer rounded-md transition-transform duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-tropic",
          state === "selected" ? "scale-[1.35]" : state === "hovered" ? "scale-[1.15]" : "scale-100",
        )}
      >
        <PinGlyph
          status={property.token.status}
          state={state}
          featured={property.featured}
          className={cn(
            "h-[42px] w-[34px]",
            state === "selected"
              ? "drop-shadow-[0_0_10px_rgba(255,107,157,0.95)]"
              : "drop-shadow-[0_3px_4px_rgba(0,0,0,0.45)]",
          )}
        />
      </button>

      {(showLabel || state !== "default") && (
        <span
          className={cn(
            "pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide whitespace-nowrap shadow",
            state === "selected" ? "bg-sunset text-ink" : "bg-black/80 text-white",
          )}
        >
          {tickerLabel(property)}
        </span>
      )}

      {state === "hovered" && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 mb-3 w-56 -translate-x-1/2 rounded-xl border border-white/10 bg-[#17182c]/95 p-3 text-left shadow-2xl shadow-black/50 backdrop-blur"
        >
          <p className="truncate font-display text-[22px] leading-none text-cream">{property.name}</p>
          <p className="mt-1 truncate text-xs text-white/55">{property.neighbourhood}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-tropic">{tickerLabel(property)}</span>
            <span className="text-white/75">
              {m ? `MC ${formatUsdCompact(m.marketCapUsd)}` : TOKEN_STATUS_LABELS[property.token.status]}
              {m?.source === "demo" && <span className="ml-1 text-[10px] font-bold text-neon">DEMO</span>}
              {m?.stale && <span className="ml-1 text-[10px] font-bold text-amber-200">DELAYED</span>}
            </span>
          </div>
          <p className="mt-2 text-[10px] tracking-[0.18em] text-white/40 uppercase">Click to view listing</p>
        </div>
      )}
    </div>
  );
});
