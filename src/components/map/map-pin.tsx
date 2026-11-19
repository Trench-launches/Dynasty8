"use client";

import { memo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { TOKEN_STATUS_LABELS } from "@/data/regions";
import { formatUsdCompact, tickerLabel } from "@/lib/format";
import type { Property } from "@/lib/types";

/** Teardrop pin outline (viewBox 0 0 34 44), tip at the bottom centre. */
export const PIN_PATH = "M17 43 C15.6 40.6 4 29 4 17.5 A13 13 0 0 1 30 17.5 C30 29 18.4 40.6 17 43 Z";
/** House symbol drawn inside the pin head. */
const HOUSE = "M17 9.2 L25 16.2 H22.6 V24.4 H19.2 V19.6 H14.8 V24.4 H11.4 V16.2 H9 Z";
const STAR =
  "M0 -5 L1.47 -1.55 L4.76 -1.55 L2.12 0.6 L2.94 4.05 L0 2.1 L-2.94 4.05 L-2.12 0.6 L-4.76 -1.55 L-1.47 -1.55 Z";

// Theme colours (globals.css); var() works in SVG presentation attributes.
export const PIN_GREEN = "var(--color-vc-primary)"; // legacy name: the brand pin colour, now light purple
export const PIN_GOLD = "var(--color-vc-cream)";
const PIN_DARK = "var(--color-vc-page)";
const PIN_LIGHT = "var(--color-vc-text)";
const PIN_MUTED_FILL = "var(--color-vc-lilac)";
const PIN_MUTED_LINE = "var(--color-vc-faint)";

export type PinState = "default" | "hovered" | "selected";

/**
 * Hover card above a pin. Near the top of the map it flips below the pin, and near the left /
 * right edge it anchors to the pin's side, driven by data-flip / data-edge on the pin wrapper.
 */
export const HOVER_CARD_CLASS = cn(
  "pointer-events-none absolute bottom-full left-1/2 mb-3 w-56 -translate-x-1/2 rounded-xl border border-vc-line bg-vc-surface/95 p-3 text-left shadow-2xl shadow-black/50 backdrop-blur",
  "[[data-flip='1']_&]:top-full [[data-flip='1']_&]:bottom-auto [[data-flip='1']_&]:mt-7 [[data-flip='1']_&]:mb-0",
  "[[data-edge='l']_&]:left-[-12px] [[data-edge='l']_&]:translate-x-0",
  "[[data-edge='r']_&]:right-[-12px] [[data-edge='r']_&]:left-auto [[data-edge='r']_&]:translate-x-0",
);

export function pinColors(status: Property["token"]["status"], state: PinState) {
  const outline = state === "selected" ? PIN_GOLD : state === "hovered" ? PIN_DARK : PIN_GREEN;
  if (status === "unavailable") return { fill: PIN_MUTED_FILL, stroke: state === "selected" ? PIN_GOLD : PIN_MUTED_LINE, house: PIN_MUTED_LINE };
  if (status === "live") return { fill: PIN_GREEN, stroke: state === "selected" ? PIN_GOLD : PIN_LIGHT, house: PIN_LIGHT };
  return { fill: PIN_LIGHT, stroke: outline, house: PIN_GREEN };
}

export function PinGlyph({
  status,
  state,
  featured,
  className,
  style,
}: {
  status: Property["token"]["status"];
  state: PinState;
  featured: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const c = pinColors(status, state);
  return (
    <svg viewBox="0 0 34 44" className={cn("overflow-visible", className)} style={style} aria-hidden="true">
      <path
        d={PIN_PATH}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={state === "selected" ? 3.2 : 2.2}
        strokeLinejoin="round"
        strokeDasharray={status === "unavailable" ? "3.5 2.5" : undefined}
      />
      <path d={HOUSE} fill={c.house} />
      {featured && (
        <g transform="translate(29 6)">
          <circle r={6.2} fill={PIN_GOLD} stroke={PIN_LIGHT} strokeWidth={1.4} />
          <path d={STAR} fill={PIN_LIGHT} transform="scale(0.85)" />
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
  /**
   * Fanned out of a cluster: the pin leans so its tip points at the cluster centre. The angle
   * comes from the `--petal-rotation` CSS variable, which the projector animates every frame.
   */
  petal?: boolean;
}

export const MapPin = memo(function MapPin({ property, state, showLabel, onSelect, onHover, petal = false }: MapPinProps) {
  const m = property.market;
  return (
    <div className="relative -translate-x-1/2 -translate-y-full select-none">
      <button
        type="button"
        aria-label={
          property.token.status === "coming_soon"
            ? `${property.name} (${tickerLabel(property)})`
            : `${property.name} (${tickerLabel(property)}), ${TOKEN_STATUS_LABELS[property.token.status]}`
        }
        aria-pressed={state === "selected"}
        onClick={() => onSelect(property.slug)}
        onPointerEnter={() => onHover(property.slug)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(property.slug)}
        onBlur={() => onHover(null)}
        // Petals lean the whole button (not just the glyph) so the hover/click area matches
        // what you see; otherwise neighbouring petals' upright boxes overlap and steal the hover.
        // (Only scale is transitioned: the projector animates the rotation every frame.)
        style={petal ? { rotate: "var(--petal-rotation, 0rad)", transitionProperty: "scale" } : undefined}
        className={cn(
          "pointer-events-auto block origin-bottom cursor-pointer rounded-md transition-transform duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-tropic",
          state === "selected" ? "scale-[1.35]" : state === "hovered" ? "scale-[1.15]" : "scale-100",
        )}
      >
        <PinGlyph
          status={property.token.status}
          state={state}
          featured={property.featured}
          className={cn(
            "h-[44px] w-[34px]",
            state === "selected"
              ? "drop-shadow-[0_0_8px_rgba(224,177,58,0.9)]"
              : "drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)]",
          )}
        />
      </button>

      {!petal && (showLabel || state !== "default") && (
        <span
          className={cn(
            "pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide whitespace-nowrap shadow",
            state === "selected" ? "bg-vc-cream text-vc-text" : "bg-vc-surface/95 text-vc-text",
          )}
        >
          {tickerLabel(property)}
        </span>
      )}

      {state === "hovered" && (
        <div
          role="tooltip"
          className={HOVER_CARD_CLASS}
        >
          <p className="truncate font-display text-[17px] leading-tight text-cream">{property.name}</p>
          <p className="mt-1 truncate text-xs text-vc-muted">{property.neighbourhood}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-tropic">{tickerLabel(property)}</span>
            <span className="text-vc-text-2">
              {m
                ? `MC ${formatUsdCompact(m.marketCapUsd)}`
                : property.token.status === "unavailable"
                  ? TOKEN_STATUS_LABELS.unavailable
                  : null}
              {m?.source === "demo" && <span className="ml-1 text-[10px] font-bold text-neon">DEMO</span>}
              {m?.stale && <span className="ml-1 text-[10px] font-bold text-amber-200">DELAYED</span>}
            </span>
          </div>
          <p className="mt-2 text-[10px] tracking-[0.18em] text-vc-faint uppercase">Click to view listing</p>
        </div>
      )}
    </div>
  );
});
