"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { formatUsdCompact } from "@/lib/format";
import { LogoMark } from "@/components/brand/logo";
import type { MapLocation } from "@/lib/types";
import { HOVER_CARD_CLASS, PIN_GOLD, PIN_GREEN, PIN_PATH, type PinState } from "./map-pin";

/** The DYNASTY Main Office on the map: a landmark for $DYNASTY, not a property listing. */
export interface HqMarker {
  id: string;
  name: string;
  area: string;
  location: MapLocation;
  ticker: string;
  marketCapUsd: number | null;
}

/**
 * A gold pin with the $DYNASTY coin in its head, so it stands apart from the white and green
 * property pins. Same teardrop as a property pin (tip at the bottom centre), drawn larger.
 */
export function HqGlyph({ state = "default", className }: { state?: PinState; className?: string }) {
  return (
    <span className={cn("relative block", className)} aria-hidden="true">
      <svg viewBox="0 0 34 44" className="size-full overflow-visible">
        <path
          d={PIN_PATH}
          fill={PIN_GOLD}
          stroke={state === "selected" ? PIN_GREEN : state === "hovered" ? "#0f5a2d" : "#ffffff"}
          strokeWidth={state === "selected" ? 3.2 : 2.4}
          strokeLinejoin="round"
        />
      </svg>
      {/* The coin sits in the pin head (centre 50% / 40% of the box, radius 38% of its width). */}
      <LogoMark className="absolute top-[16%] left-1/2 aspect-square w-[62%] -translate-x-1/2 ring-[1.5px] ring-white" />
    </span>
  );
}

interface HqPinProps {
  hq: HqMarker;
  state: PinState;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export const HqPin = memo(function HqPin({ hq, state, onSelect, onHover }: HqPinProps) {
  return (
    <div className="relative -translate-x-1/2 -translate-y-full select-none">
      <button
        type="button"
        aria-label={`${hq.name}, home of $${hq.ticker}`}
        aria-pressed={state === "selected"}
        onClick={() => onSelect(hq.id)}
        onPointerEnter={() => onHover(hq.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(hq.id)}
        onBlur={() => onHover(null)}
        className={cn(
          "pointer-events-auto block origin-bottom cursor-pointer rounded-md transition-transform duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-tropic",
          state === "selected" ? "scale-[1.2]" : state === "hovered" ? "scale-110" : "scale-100",
        )}
      >
        <HqGlyph
          state={state}
          className={cn(
            "h-[60px] w-[46px]",
            state === "selected"
              ? "drop-shadow-[0_0_10px_rgba(224,177,58,0.95)]"
              : "drop-shadow-[0_3px_4px_rgba(0,0,0,0.45)]",
          )}
        />
      </button>

      {/* Always labelled, at every zoom: it is the one landmark on the map. */}
      <span className="pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded bg-[#e0b13a] px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide whitespace-nowrap text-[#212529] shadow">
        DYNASTY HQ
      </span>

      {state === "hovered" && (
        <div role="tooltip" className={HOVER_CARD_CLASS}>
          <p className="truncate font-display text-[17px] leading-tight text-cream">{hq.name}</p>
          <p className="mt-1 truncate text-xs text-[#6c757d]">Headquarters · {hq.area}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-tropic">${hq.ticker}</span>
            {hq.marketCapUsd != null && (
              <span className="text-[#495057]">MC {formatUsdCompact(hq.marketCapUsd)}</span>
            )}
          </div>
          <p className="mt-2 text-[10px] tracking-[0.18em] text-[#868e96] uppercase">Click for ${hq.ticker} details</p>
        </div>
      )}
    </div>
  );
});
