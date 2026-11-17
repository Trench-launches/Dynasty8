"use client";

import { useEffect, useMemo } from "react";
import { Compass, LocateFixed, Minus, Plus } from "lucide-react";
import type { Property } from "@/data/types";
import { brand } from "@/config/brand";
import { cn, formatUsdCompact } from "@/lib/utils";
import { Change } from "@/components/ui/change";
import { CityMapBase } from "./city-map-base";
import { MAP_H, MAP_W, MAX_ZOOM, MIN_ZOOM, usePanZoom } from "./use-pan-zoom";

const CLUSTER_PX = 46;
const PETAL_LEN = 56;

export interface FocusRequest {
  slug: string;
  nonce: number;
  /** Minimum zoom to fly to. */
  zoom?: number;
}

interface Props {
  properties: Property[];
  selectedSlug: string | null;
  hoveredSlug: string | null;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
  focus: FocusRequest | null;
  /** Shift the fly-to centre (px) so the target is not hidden by an overlay panel. */
  focusOffsetPx?: { x: number; y: number };
  className?: string;
}

interface Cluster {
  id: string;
  members: Property[];
  left: number;
  top: number;
}

/** Teardrop pin with a house, drawn tip-down at (24, 58) in a 48x60 box. */
function PinGraphic({ active, hovered }: { active: boolean; hovered: boolean }) {
  return (
    <svg viewBox="0 0 48 60" className="h-full w-full overflow-visible drop-shadow-[0_4px_6px_rgba(21,21,46,0.35)]">
      <defs>
        <linearGradient id="pin-active" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF6B9D" />
          <stop offset="0.6" stopColor="#FF8066" />
          <stop offset="1" stopColor="#FFB36B" />
        </linearGradient>
      </defs>
      <path
        d="M24 58 C 20 48 4 38 4 24 A20 20 0 1 1 44 24 C 44 38 28 48 24 58 Z"
        fill={active ? "url(#pin-active)" : "#FFFFFF"}
        stroke={active ? "#FFF3E8" : hovered ? "#FF6B9D" : "#30204F"}
        strokeWidth={active ? 3.5 : 2.5}
      />
    </svg>
  );
}

function HouseIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-full w-full">
      <path
        d="M3 11.5 L12 4 L21 11.5 V20 H14.5 V14.5 H9.5 V20 H3 Z"
        fill={active ? "#FFFFFF" : "#30204F"}
        stroke={active ? "#FFFFFF" : "#30204F"}
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <rect x="15.5" y="5" width="2.6" height="4.5" fill={active ? "#FFFFFF" : "#FF6B9D"} />
    </svg>
  );
}

export function PropertyMap({
  properties,
  selectedSlug,
  hoveredSlug,
  onSelect,
  onHover,
  focus,
  focusOffsetPx,
  className,
}: Props) {
  const { containerRef, t, vp, ready, toScreen, zoomBy, flyTo, reset } = usePanZoom();

  // Fly to a property when the sidebar (or URL) asks for it.
  useEffect(() => {
    if (!focus || !ready) return;
    const p = properties.find((x) => x.slug === focus.slug);
    if (p) flyTo(p.position, focus.zoom ?? 2.4, focusOffsetPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, ready]);

  const clusters = useMemo<Cluster[]>(() => {
    const placed = properties.map((p) => ({ p, s: toScreen(p.position) }));
    const used = new Set<string>();
    const out: Cluster[] = [];
    for (const a of placed) {
      if (used.has(a.p.slug)) continue;
      const members = placed.filter(
        (b) => !used.has(b.p.slug) && Math.hypot(a.s.left - b.s.left, a.s.top - b.s.top) < CLUSTER_PX,
      );
      members.forEach((m) => used.add(m.p.slug));
      out.push({
        id: members.map((m) => m.p.slug).join("|"),
        members: members.map((m) => m.p),
        left: members.reduce((s, m) => s + m.s.left, 0) / members.length,
        top: members.reduce((s, m) => s + m.s.top, 0) / members.length,
      });
    }
    // Draw the cluster containing the selection last so it sits on top.
    return out.sort(
      (x, y) =>
        Number(x.members.some((m) => m.slug === selectedSlug)) - Number(y.members.some((m) => m.slug === selectedSlug)),
    );
  }, [properties, toScreen, selectedSlug]);

  // Where to anchor the hover tooltip.
  const tooltip = useMemo(() => {
    if (!hoveredSlug) return null;
    for (const c of clusters) {
      const i = c.members.findIndex((m) => m.slug === hoveredSlug);
      if (i < 0) continue;
      if (c.members.length === 1) return { p: c.members[0], left: c.left, top: c.top - 56 };
      const th = (i / c.members.length) * Math.PI * 2;
      return {
        p: c.members[i],
        left: c.left + Math.sin(th) * PETAL_LEN * 0.7,
        top: c.top - Math.cos(th) * PETAL_LEN * 0.7 - 30,
      };
    }
    return null;
  }, [hoveredSlug, clusters]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "+" || e.key === "=") zoomBy(1.4);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.4);
    else if (e.key === "0") reset();
    else return;
    e.preventDefault();
  };

  const markerButton = (p: Property, extra: string, style: React.CSSProperties, inner: React.ReactNode) => {
    const active = p.slug === selectedSlug;
    return (
      <button
        key={p.slug}
        type="button"
        aria-label={`${p.name}, $${p.market.ticker}`}
        aria-pressed={active}
        onClick={() => onSelect(p.slug)}
        onMouseEnter={() => onHover(p.slug)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(p.slug)}
        onBlur={() => onHover(null)}
        className={cn(
          "absolute cursor-pointer rounded-full outline-none transition-[filter] duration-200 focus-visible:ring-4 focus-visible:ring-neon/60",
          extra,
        )}
        style={style}
      >
        {inner}
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Interactive property map. Drag to pan, scroll or pinch to zoom, plus and minus keys to zoom."
      role="application"
      className={cn(
        "map-surface relative h-full w-full cursor-grab overflow-hidden bg-[#e9e1ee] outline-none active:cursor-grabbing",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
          <CityMapBase k={t.k} />
        </g>
      </svg>

      {/* Markers */}
      <div className="pointer-events-none absolute inset-0">
        {clusters.map((c) => {
          if (c.members.length === 1) {
            const p = c.members[0];
            const active = p.slug === selectedSlug;
            const hovered = p.slug === hoveredSlug;
            const size = active ? 1.3 : hovered ? 1.12 : 1;
            return (
              <div key={c.id} className="absolute" style={{ left: c.left, top: c.top, zIndex: active ? 30 : hovered ? 20 : 10 }}>
                {active && (
                  <span className="absolute -left-5 -top-3 h-6 w-10 animate-pulse-ring rounded-[50%] border-2 border-sunset" />
                )}
                {markerButton(
                  p,
                  "pointer-events-auto",
                  {
                    width: 40,
                    height: 50,
                    left: -20,
                    top: -50,
                    transform: `scale(${size})`,
                    transformOrigin: "50% 100%",
                    transition: "transform 180ms ease",
                  },
                  <>
                    <PinGraphic active={active} hovered={hovered} />
                    <span className="absolute left-1/2 top-[9px] h-[18px] w-[18px] -translate-x-1/2">
                      <HouseIcon active={active} />
                    </span>
                  </>,
                )}
                {active && (
                  <span className="pointer-events-none absolute left-1/2 top-[-86px] -translate-x-1/2 whitespace-nowrap rounded-full bg-midnight px-2 py-0.5 text-[11px] font-extrabold text-cream shadow-lg">
                    ${p.market.ticker}
                  </span>
                )}
              </div>
            );
          }
          // Flower cluster: petals point into a shared centre, like a building with several listings.
          const hasActive = c.members.some((m) => m.slug === selectedSlug);
          return (
            <div key={c.id} className="absolute" style={{ left: c.left, top: c.top, zIndex: hasActive ? 30 : 15 }}>
              <span className="absolute -left-[7px] -top-[7px] h-[14px] w-[14px] rounded-full border-2 border-white bg-midnight shadow" />
              {c.members.map((p, i) => {
                const active = p.slug === selectedSlug;
                const hovered = p.slug === hoveredSlug;
                const deg = (i / c.members.length) * 360;
                return markerButton(
                  p,
                  "pointer-events-auto",
                  {
                    width: 46,
                    height: PETAL_LEN,
                    left: -23,
                    top: -PETAL_LEN,
                    transform: `rotate(${deg}deg) scale(${active ? 1.18 : hovered ? 1.08 : 1})`,
                    transformOrigin: "50% 100%",
                    transition: "transform 180ms ease",
                    zIndex: active ? 3 : hovered ? 2 : 1,
                  },
                  <>
                    <PinGraphic active={active} hovered={hovered} />
                    <span
                      className="absolute left-1/2 top-[9px] h-[18px] w-[18px] -translate-x-1/2"
                      style={{ transform: `translateX(-50%) rotate(${-deg}deg)` }}
                    >
                      <HouseIcon active={active} />
                    </span>
                  </>,
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-40 w-52 -translate-x-1/2 -translate-y-full rounded-2xl bg-white/95 p-3 shadow-[0_12px_30px_-10px_rgba(21,21,46,0.5)] ring-1 ring-violet/10 backdrop-blur"
          style={{ left: tooltip.left, top: tooltip.top }}
          role="tooltip"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-display text-base tracking-wide text-violet">{tooltip.p.name}</p>
            <span className="rounded-full bg-sunset px-1.5 py-0.5 text-[10px] font-extrabold text-white">
              ${tooltip.p.market.ticker}
            </span>
          </div>
          <p className="text-[11px] font-semibold text-violet/60">{tooltip.p.neighbourhood}</p>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="font-bold text-violet">{formatUsdCompact(tooltip.p.market.marketCapUsd)} mcap</span>
            <Change value={tooltip.p.market.change24hPct} className="text-xs" />
          </div>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-[#9a4a10]">Demo data</p>
        </div>
      )}

      {/* Map chrome */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-white/85 text-violet shadow ring-1 ring-violet/10 backdrop-blur">
          <Compass className="size-6" style={{ transform: "rotate(-20deg)" }} aria-hidden />
        </span>
        <span className="rounded-full bg-white/85 px-3 py-1 font-display text-sm tracking-wider shadow ring-1 ring-violet/10 backdrop-blur">
          <span className="text-sunset">{brand.mapLabel}</span>
        </span>
      </div>

      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl bg-white/90 shadow-lg ring-1 ring-violet/10 backdrop-blur">
        <button
          type="button"
          onClick={() => zoomBy(1.5)}
          disabled={t.k >= MAX_ZOOM - 0.01}
          aria-label="Zoom in"
          className="grid h-11 w-11 cursor-pointer place-items-center text-violet hover:bg-sunset hover:text-white disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-violet"
        >
          <Plus className="size-5" />
        </button>
        <span className="h-px bg-violet/10" />
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.5)}
          disabled={t.k <= MIN_ZOOM + 0.01}
          aria-label="Zoom out"
          className="grid h-11 w-11 cursor-pointer place-items-center text-violet hover:bg-sunset hover:text-white disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-violet"
        >
          <Minus className="size-5" />
        </button>
        <span className="h-px bg-violet/10" />
        <button
          type="button"
          onClick={reset}
          aria-label="Reset map view"
          className="grid h-11 w-11 cursor-pointer place-items-center text-violet hover:bg-sunset hover:text-white"
        >
          <LocateFixed className="size-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-midnight/70 px-2 py-1 text-[10px] font-semibold text-cream/90 backdrop-blur">
        Fictional city · {Math.round(t.k * 100)}% · {properties.length} listed
      </div>

      {properties.length === 0 && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="rounded-2xl bg-white/90 px-5 py-4 text-center shadow-lg">
            <p className="font-display text-lg tracking-wide text-violet">No properties on the map</p>
            <p className="text-sm text-violet/70">Change the filters to see listings again.</p>
          </div>
        </div>
      )}
      <span className="sr-only">{vp.w > 0 ? "" : "Loading map"}</span>
    </div>
  );
}
