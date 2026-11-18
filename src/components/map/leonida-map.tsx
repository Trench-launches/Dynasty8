"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Canvas } from "@react-three/fiber";
import { ChevronDown, Locate, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { REGIONS } from "@/data/regions";
import type { MapLocation, Property } from "@/lib/types";
import {
  CameraRig,
  PinProjector,
  SelectionBeacon,
  type Insets,
  type PinCluster,
  type RigApi,
  type ViewMode,
} from "./leonida-scene";

import { LEONIDA_SEA, TileGround } from "./tile-ground";
import { LEONIDA_MAP_CREDIT } from "./tiles";

export type { Insets } from "./leonida-scene";
import { MapPin, PIN_GOLD, PIN_GREEN, PinGlyph, type PinState } from "./map-pin";
import { HqGlyph, HqPin, type HqMarker } from "./hq-pin";

export interface LeonidaMapHandle {
  focus(location: MapLocation): void;
  reset(): void;
}

interface LeonidaMapProps {
  apiRef?: Ref<LeonidaMapHandle>;
  properties: Property[];
  selectedSlug: string | null;
  hoveredSlug: string | null;
  onSelect: (slug: string | null) => void;
  onHover: (slug: string | null) => void;
  /** Screen area covered by overlays (preview panel / bottom sheet). */
  insets?: Insets;
  /** Pixels to keep clear at the top (e.g. for a floating search bar on mobile). */
  topOffset?: number;
  /** Location to fly to when the map first appears (deep links). */
  initialFocus?: MapLocation | null;
  /** The DYNASTY Main Office landmark. Selected and hovered by its id, like a property slug. */
  hq?: HqMarker | null;
  className?: string;
  children?: ReactNode;
}

const FOG = LEONIDA_SEA;
/** How far a press on a pin must move before it becomes a map drag instead of a click. */
const PIN_DRAG_SLOP_PX = 5;

export default function LeonidaMap({
  apiRef,
  properties,
  selectedSlug,
  hoveredSlug,
  onSelect,
  onHover,
  insets = { right: 0, bottom: 0 },
  topOffset = 0,
  initialFocus = null,
  hq = null,
  className,
  children,
}: LeonidaMapProps) {
  const rig = useRef<RigApi>(null);
  const pinEls = useRef(new Map<string, HTMLElement>());
  const clusterEls = useRef(new Map<string, HTMLElement>());
  const selectedRef = useRef<string | null>(selectedSlug);
  const expandedRef = useRef<string | null>(null);
  const [clusters, setClusters] = useState<PinCluster[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    selectedRef.current = selectedSlug;
    expandedRef.current = expanded;
  });
  const compassRef = useRef<HTMLSpanElement>(null);
  const insetsRef = useRef(insets);
  const introFocusRef = useRef<{ location: MapLocation; insets: Insets } | null>(null);
  useEffect(() => {
    insetsRef.current = insets;
    introFocusRef.current = initialFocus ? { location: initialFocus, insets } : null;
  });
  // 2D only for now. The 3D camera, lighting and buildings live on in leonida-scene.tsx for later.
  const mode: ViewMode = "2d";
  const [ready, setReady] = useState(false);
  const [near, setNear] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 1023px)");
  const rootRef = useRef<HTMLDivElement>(null);
  // On small screens the bottom sheet needs the room; controls come back when it closes.
  const showChrome = !(compact && insets.bottom > 0);

  /** Pins sit above the canvas; pass wheel zoom through to the map controls. */
  const forwardWheel = (e: React.WheelEvent) => {
    const canvas = rootRef.current?.querySelector("canvas");
    if (!canvas) return;
    const n = e.nativeEvent;
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: n.deltaX,
        deltaY: n.deltaY,
        deltaMode: n.deltaMode,
        clientX: n.clientX,
        clientY: n.clientY,
        ctrlKey: n.ctrlKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  /**
   * Pins and cluster badges sit above the canvas, so a drag that starts on one would never
   * reach the map controls. Once a press on them moves a few pixels, hand it to the controls
   * as if it had started on the map (they then follow the pointer on the document), and
   * swallow the click that ends the drag so it doesn't also select the pin under the cursor.
   */
  const startPinDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const down = e.nativeEvent;
    const doc = rootRef.current?.ownerDocument ?? document;
    let handedOver = false;

    const onMove = (m: PointerEvent) => {
      if (m.pointerId !== down.pointerId || handedOver) return;
      if (Math.hypot(m.clientX - down.clientX, m.clientY - down.clientY) < PIN_DRAG_SLOP_PX) return;
      const canvas = rootRef.current?.querySelector("canvas");
      if (!canvas) return;
      handedOver = true;
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: down.pointerId,
          pointerType: down.pointerType,
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: down.clientX,
          clientY: down.clientY,
          screenX: down.screenX,
          screenY: down.screenY,
          ctrlKey: down.ctrlKey,
          shiftKey: down.shiftKey,
          metaKey: down.metaKey,
          altKey: down.altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    const swallowClick = (c: MouseEvent) => {
      c.preventDefault();
      c.stopPropagation();
    };
    const onEnd = (u: PointerEvent) => {
      if (u.pointerId !== down.pointerId) return;
      doc.removeEventListener("pointermove", onMove);
      doc.removeEventListener("pointerup", onEnd);
      doc.removeEventListener("pointercancel", onEnd);
      if (!handedOver) return;
      // The click (if any) is dispatched right after pointerup, before any timer runs.
      window.addEventListener("click", swallowClick, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
    };
    doc.addEventListener("pointermove", onMove);
    doc.addEventListener("pointerup", onEnd);
    doc.addEventListener("pointercancel", onEnd);
  };

  useImperativeHandle(apiRef, () => ({
    focus: (location) => rig.current?.focus(location, insetsRef.current),
    reset: () => rig.current?.reset(),
  }));

  const markReady = useCallback(() => setReady(true), []);
  const expandedAtRef = useRef(0);
  const closeTimer = useRef<number | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  /** Fan a cluster out (or close it with null); a newly opened cluster replays the sweep. */
  const openCluster = useCallback(
    (id: string | null) => {
      cancelClose();
      if (id && id !== expandedRef.current) expandedAtRef.current = performance.now();
      setExpanded(id);
    },
    [cancelClose],
  );
  /** Hover-opened clusters close shortly after the mouse leaves the badge and its pins. */
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setExpanded(null), 300);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);
  const collapse = useCallback(() => openCluster(null), [openCluster]);
  const onClusters = useCallback((next: PinCluster[]) => {
    setClusters(next);
    setExpanded((id) => (id && next.some((c) => c.id === id) ? id : null));
  }, []);
  /** Pins of the fanned-out cluster. */
  const petals = new Set(clusters.find((c) => c.id === expanded)?.slugs ?? []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // let pins and buttons handle their own keys
    const api = rig.current;
    if (!api) return;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => api.panBy(-120, 0),
      ArrowRight: () => api.panBy(120, 0),
      ArrowUp: () => api.panBy(0, -120),
      ArrowDown: () => api.panBy(0, 120),
      "+": () => api.zoomBy(1 / 1.5),
      "=": () => api.zoomBy(1 / 1.5),
      "-": () => api.zoomBy(1.5),
      "0": () => api.reset(),
      Escape: () => {
        openCluster(null);
        onSelect(null);
      },
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const mapped = properties.filter((p) => p.location).length;
  const landmarks = useMemo(() => (hq ? [{ id: hq.id, location: hq.location }] : []), [hq]);
  const hqState: PinState | null = hq
    ? hq.id === selectedSlug
      ? "selected"
      : hq.id === hoveredSlug
        ? "hovered"
        : "default"
    : null;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      role="region"
      aria-label="Interactive property map. Drag to pan, scroll or pinch to zoom. Arrow keys pan, plus and minus zoom, 0 resets."
      onKeyDown={onKeyDown}
      className={cn(
        "relative isolate overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-tropic/60 focus-visible:ring-inset",
        className,
      )}
      style={{ background: FOG }}
    >
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ fov: 35, near: 1, far: 20000, position: [0, 4000, 1] }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onPointerMissed={() => {
          openCluster(null);
          onSelect(null);
        }}
        className="!absolute inset-0 touch-none"
        fallback={
          <div className="grid h-full place-items-center p-6 text-center text-sm text-[#495057]">
            Your browser can&apos;t display the 3D map. The property list still works.
          </div>
        }
      >
        <fog attach="fog" args={[FOG, 4000, 12000]} />
        <TileGround onReady={markReady} />
        <SelectionBeacon location={properties.find((p) => p.slug === selectedSlug)?.location ?? null} />
        <CameraRig
          ref={rig}
          mode={mode}
          introReady={ready}
          compassRef={compassRef}
          introFocusRef={introFocusRef}
          onZoomBand={setNear}
          onInteract={collapse}
        />
        {/* After CameraRig: pins are placed with the camera as moved for this frame. */}
        <PinProjector
          properties={properties}
          landmarks={landmarks}
          pinEls={pinEls}
          clusterEls={clusterEls}
          selectedRef={selectedRef}
          expandedRef={expandedRef}
          expandedAtRef={expandedAtRef}
          onClusters={onClusters}
        />
      </Canvas>

      {/* Pins: positioned every frame by PinProjector */}
      <div
        className="pointer-events-none absolute inset-0 z-20 isolate touch-none overflow-hidden"
        aria-label="Property pins"
        onWheel={forwardWheel}
        onPointerDown={startPinDrag}
      >
        {properties.map((p) => {
          if (!p.location) return null;
          const state: PinState =
            p.slug === selectedSlug ? "selected" : p.slug === hoveredSlug ? "hovered" : "default";
          return (
            <div
              key={p.slug}
              data-state={state}
              ref={(el) => {
                if (el) pinEls.current.set(p.slug, el);
                else pinEls.current.delete(p.slug);
              }}
              // The wrapper's own box sits below-right of the pin it carries (the pin is shifted
              // up-left onto the tip), so it must not take the pointer or it steals hovers from
              // neighbouring pins. Only the pin button is hoverable; enter/leave still bubble here.
              // Stacking: pins sort by depth (< 50,000), fanned-out pins 200,000+, cluster badges
              // 150,000 / 300,000 (open). Hovered and selected pins go above all of them so their
              // card is never covered; !important beats the per-frame inline z-index.
              className="pointer-events-none absolute top-0 left-0 will-change-transform data-[state=hovered]:z-[500000]! data-[state=selected]:z-[400000]!"
              style={{ display: "none" }}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse" && petals.has(p.slug)) cancelClose();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse" && petals.has(p.slug)) scheduleClose();
              }}
            >
              <MapPin
                property={p}
                state={state}
                showLabel={near}
                onSelect={onSelect}
                onHover={onHover}
                petal={petals.has(p.slug)}
              />
            </div>
          );
        })}

        {/* DYNASTY HQ landmark: positioned by PinProjector like a pin, never clustered. */}
        {hq && hqState && (
          <div
            key={hq.id}
            data-state={hqState}
            ref={(el) => {
              if (el) pinEls.current.set(hq.id, el);
              else pinEls.current.delete(hq.id);
            }}
            className="pointer-events-none absolute top-0 left-0 will-change-transform data-[state=hovered]:z-[500000]! data-[state=selected]:z-[400000]!"
            style={{ display: "none" }}
          >
            <HqPin hq={hq} state={hqState} onSelect={onSelect} onHover={onHover} />
          </div>
        )}

        {/* Cluster badges: pins that crowd together on screen; click to fan them out. */}
        {clusters.map((c) => {
          const isOpen = c.id === expanded;
          return (
            <div
              key={c.id}
              ref={(el) => {
                if (el) clusterEls.current.set(c.id, el);
                else clusterEls.current.delete(c.id);
              }}
              className="pointer-events-none absolute top-0 left-0 will-change-transform"
              style={{ display: "none", zIndex: isOpen ? 300000 : 150000 }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={isOpen ? "Close group" : `Show ${c.slugs.length} properties here`}
                onClick={() => openCluster(isOpen ? null : c.id)}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "mouse") return;
                  cancelClose();
                  if (!isOpen) openCluster(c.id);
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === "mouse") scheduleClose();
                }}
                className={cn(
                  "pointer-events-auto grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-white font-display leading-none text-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2",
                  isOpen ? "size-6 text-sm" : "size-10 text-lg",
                )}
                style={{ background: PIN_GREEN, outlineColor: PIN_GOLD }}
              >
                {isOpen ? <X className="size-3.5" strokeWidth={3.2} aria-hidden="true" /> : c.slugs.length}
              </button>
            </div>
          );
        })}
      </div>

      {!ready && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <span className="size-10 animate-spin rounded-full border-2 border-[#dee2e6] border-t-sunset" />
            <p className="font-display text-xl tracking-[0.25em] text-[#212529]">LOADING LEONIDA</p>
          </div>
        </div>
      )}

      {/* Region quick-jump */}
      <nav
        aria-label="Jump to region"
        className="scrollbar-thin absolute left-3 z-30 flex gap-1.5 overflow-x-auto pb-1"
        style={{ top: topOffset + 12, maxWidth: `calc(100% - ${insets.right + 80}px)` }}
      >
        {REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => rig.current?.flyToRegion(r.id)}
            className="shrink-0 rounded border border-[#dee2e6] bg-white/80 px-3.5 py-2 font-display text-[15px] leading-none tracking-[0.08em] text-[#212529] backdrop-blur transition-colors hover:border-sunset/60 hover:bg-white/95 hover:text-[#212529]"
          >
            {r.name.toUpperCase()}
          </button>
        ))}
      </nav>

      {/* Camera controls */}
      <div
        className={cn(
          "absolute z-30 flex flex-col items-end gap-2 transition-[right,top] duration-300",
          !showChrome && "hidden",
        )}
        style={{ right: insets.right + 14, top: topOffset + 14 }}
      >
        <div className="flex flex-col overflow-hidden rounded-md border-2 border-white shadow-[0_2px_6px_rgba(0,0,0,0.3)]" style={{ background: PIN_GREEN }}>
          <ControlButton label="Zoom in" onClick={() => rig.current?.zoomBy(1 / 1.6)}>
            <Plus />
          </ControlButton>
          <ControlButton label="Zoom out" onClick={() => rig.current?.zoomBy(1.6)}>
            <Minus />
          </ControlButton>
          <ControlButton label="Show whole map" onClick={() => rig.current?.reset()}>
            <Locate />
          </ControlButton>
        </div>
      </div>

      {/* Compass (the map is always north-up in 2D) */}
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute left-3 z-30", !showChrome && "hidden")}
        style={{ top: topOffset + 58 }}
      >
        <Compass />
      </div>

      {/* Gold frame */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-40 border-[3px]"
        style={{ borderColor: PIN_GOLD, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.6)" }}
      />

      {/* Legend */}
      <div
        className={cn("absolute bottom-3 left-3 z-30 transition-[bottom] duration-300", !showChrome && "hidden")}
        style={{ bottom: insets.bottom + 12 }}
      >
        <button
          type="button"
          onClick={() => setLegendOpen((o) => !o)}
          aria-expanded={legendOpen}
          className="flex items-center gap-1.5 rounded-md border border-[#dee2e6] bg-white/95 px-2.5 py-1.5 text-[11px] font-bold tracking-[0.16em] text-[#495057] uppercase backdrop-blur hover:text-[#212529]"
        >
          {mapped} on map
          <ChevronDown className={cn("size-3.5 transition-transform", legendOpen && "rotate-180")} />
        </button>
        {legendOpen && (
          <ul className="mt-1.5 space-y-1.5 rounded-lg border border-[#dee2e6] bg-white/95 p-3 text-xs text-[#212529] backdrop-blur">
            {hq && <LegendRow label="DYNASTY HQ" glyph={<HqGlyph className="h-5 w-4" />} />}
            <LegendRow label="Property" glyph={<PinGlyph status="coming_soon" state="default" featured={false} className="h-5 w-4" />} />
            <LegendRow label="Token live" glyph={<PinGlyph status="live" state="default" featured={false} className="h-5 w-4" />} />
            <LegendRow label="Featured" glyph={<PinGlyph status="coming_soon" state="default" featured className="h-5 w-4" />} />
            <LegendRow label="Unavailable" glyph={<PinGlyph status="unavailable" state="default" featured={false} className="h-5 w-4" />} />
            <LegendRow label="Selected" glyph={<PinGlyph status="coming_soon" state="selected" featured={false} className="h-5 w-4" />} />
            <li className="pt-1 text-[10px] leading-snug text-[#868e96]">Pins show approximate district placement.</li>
          </ul>
        )}
      </div>

      {/* Map credit (CC BY 4.0 requires it) */}
      <p
        className={cn(
          "pointer-events-auto absolute z-30 max-w-[60%] truncate rounded bg-white/80 px-1.5 py-0.5 text-right text-[10px] leading-tight text-[#495057] backdrop-blur transition-[bottom,right] duration-300",
          !showChrome && "hidden",
        )}
        style={{ right: insets.right + 12, bottom: insets.bottom + 10 }}
      >
        Map:{" "}
        <a href={LEONIDA_MAP_CREDIT.href} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#212529]">
          gtadb.org
        </a>{" "}
        &amp; GTA VI Community Mapping Project,{" "}
        <a href={LEONIDA_MAP_CREDIT.license} target="_blank" rel="noopener noreferrer" className="underline hover:text-[#212529]">
          CC BY 4.0
        </a>{" "}
        (legend removed)
      </p>

      {children}
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "grid size-9 place-items-center text-white transition-colors hover:bg-[#0f5a2d] focus-visible:bg-[#0f5a2d] focus-visible:outline-none [&+&]:border-t [&+&]:border-white/40 [&_svg]:size-4 [&_svg]:stroke-[3]",
        pressed === true && "text-tropic",
        pressed === false && "text-[#868e96]",
      )}
    >
      {children}
    </button>
  );
}

function LegendRow({ label, glyph }: { label: string; glyph: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="grid w-5 place-items-center">{glyph}</span>
      {label}
    </li>
  );
}

/** North-up compass rose (original design). */
function Compass() {
  return (
    <svg viewBox="-24 -24 48 48" className="size-12 drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)]">
      <circle r={21} fill="rgba(255,255,255,0.85)" stroke={PIN_GREEN} strokeWidth={2} />
      {/* Star sits a little low so the N has the gap between its tip and the rim to itself. */}
      <g transform="translate(0 2.5)">
        <path d="M0 -12 L3.2 -3.2 L15 0 L3.2 3.2 L0 15 L-3.2 3.2 L-15 0 L-3.2 -3.2 Z" fill={PIN_GREEN} />
        <path d="M0 -12 L3.2 -3.2 L0 0 Z M15 0 L3.2 3.2 L0 0 Z M0 15 L-3.2 3.2 L0 0 Z M-15 0 L-3.2 -3.2 L0 0 Z" fill="#0f5a2d" />
        <circle r={2.2} fill="#ffffff" />
      </g>
      <text
        x={0}
        y={-14.2}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={8}
        fontWeight={800}
        fill={PIN_GREEN}
      >
        N
      </text>
    </svg>
  );
}
