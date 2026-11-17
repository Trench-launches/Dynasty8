"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Canvas } from "@react-three/fiber";
import { ChevronDown, Locate, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { REGIONS } from "@/data/regions";
import type { MapLocation, Property } from "@/lib/types";
import {
  CameraRig,
  MapGround,
  PinProjector,
  SelectionBeacon,
  type Insets,
  type RigApi,
  type ViewMode,
} from "./leonida-scene";

export type { Insets } from "./leonida-scene";
import { MapPin, PinGlyph, type PinState } from "./map-pin";

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
  className?: string;
  children?: ReactNode;
}

const FOG = "#e7a3b8";

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
  className,
  children,
}: LeonidaMapProps) {
  const rig = useRef<RigApi>(null);
  const pinEls = useRef(new Map<string, HTMLElement>());
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

  useImperativeHandle(apiRef, () => ({
    focus: (location) => rig.current?.focus(location, insetsRef.current),
    reset: () => rig.current?.reset(),
  }));

  const markReady = useCallback(() => setReady(true), []);
  const noop = useCallback(() => {}, []);

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
      Escape: () => onSelect(null),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  const mapped = properties.filter((p) => p.location).length;

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
      style={{
        background: `linear-gradient(to bottom, #120c26 0%, #3b1d5c 28%, #a3487f 48%, ${FOG} 62%, ${FOG} 100%)`,
      }}
    >
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ fov: 35, near: 1, far: 20000, position: [0, 4000, 1] }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onPointerMissed={() => onSelect(null)}
        className="!absolute inset-0 touch-none"
        fallback={
          <div className="grid h-full place-items-center p-6 text-center text-sm text-[#495057]">
            Your browser can&apos;t display the 3D map. The property list still works.
          </div>
        }
      >
        <fog attach="fog" args={[FOG, 4000, 12000]} />
        <MapGround onReady={markReady} />
        <PinProjector properties={properties} pinEls={pinEls} />
        <SelectionBeacon location={properties.find((p) => p.slug === selectedSlug)?.location ?? null} />
        <CameraRig
          ref={rig}
          mode={mode}
          introReady={ready}
          compassRef={compassRef}
          introFocusRef={introFocusRef}
          onZoomBand={setNear}
          onInteract={noop}
        />
      </Canvas>

      {/* Pins: positioned every frame by PinProjector */}
      <div
        className="pointer-events-none absolute inset-0 z-20 isolate overflow-hidden"
        aria-label="Property pins"
        onWheel={forwardWheel}
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
              className="pointer-events-auto absolute top-0 left-0 will-change-transform"
              style={{ display: "none" }}
            >
              <MapPin property={p} state={state} showLabel={near} onSelect={onSelect} onHover={onHover} />
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
        style={{ top: topOffset + 12, maxWidth: `calc(100% - ${insets.right + 24}px)` }}
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
          "absolute z-30 flex flex-col items-end gap-2 transition-[right,bottom] duration-300",
          !showChrome && "hidden",
        )}
        style={{ right: insets.right + 12, bottom: insets.bottom + 12 }}
      >
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#dee2e6] bg-white/85 backdrop-blur">
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
            <LegendRow label="Token coming soon" glyph={<PinGlyph status="coming_soon" state="default" featured={false} className="h-5 w-4" />} />
            <LegendRow label="Token live" glyph={<PinGlyph status="live" state="default" featured={false} className="h-5 w-4" />} />
            <LegendRow label="Featured" glyph={<PinGlyph status="coming_soon" state="default" featured className="h-5 w-4" />} />
            <LegendRow label="Unavailable" glyph={<PinGlyph status="unavailable" state="default" featured={false} className="h-5 w-4" />} />
            <LegendRow label="Selected" glyph={<PinGlyph status="coming_soon" state="selected" featured={false} className="h-5 w-4" />} />
            <li className="pt-1 text-[10px] leading-snug text-[#868e96]">Pins show approximate district placement.</li>
          </ul>
        )}
      </div>

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
        "grid size-10 place-items-center text-[#212529] transition-colors hover:bg-[#e9ecef] hover:text-[#212529] focus-visible:bg-[#e9ecef] focus-visible:outline-none [&+&]:border-t [&+&]:border-[#dee2e6] [&_svg]:size-4",
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
