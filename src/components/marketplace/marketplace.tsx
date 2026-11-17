"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { List, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, usingMockApi } from "@/lib/api";
import { DEFAULT_FILTERS, applyFilters, type Filters } from "@/lib/filters";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Property } from "@/lib/types";
import type { Insets, LeonidaMapHandle } from "@/components/map/leonida-map";
import { ListingSidebar } from "./listing-sidebar";
import { PropertyPreview } from "./property-preview";
import { SearchBox } from "./listing-filters";

const LeonidaMap = dynamic(() => import("@/components/map/leonida-map"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center bg-[#1e5d9c]">
      <span className="size-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
    </div>
  ),
});

const PANEL_WIDTH = 380;
const REFRESH_MS = 60_000;

function useViewportHeight() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => window.innerHeight,
    () => 800,
  );
}

function readSlugFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("p");
}

export function Marketplace({ initialProperties }: { initialProperties: Property[] }) {
  const [properties, setProperties] = useState(initialProperties);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [focusRequest, setFocusRequest] = useState(0);
  const [initialSlug, setInitialSlug] = useState<string | null>(null);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const viewportHeight = useViewportHeight();
  const mapRef = useRef<LeonidaMapHandle>(null);

  const visible = useMemo(() => applyFilters(properties, filters), [properties, filters]);
  const selected = useMemo(() => properties.find((p) => p.slug === selectedSlug) ?? null, [properties, selectedSlug]);

  // Deep link: /?p=slug opens that listing.
  useEffect(() => {
    const slug = readSlugFromUrl();
    if (slug && initialProperties.some((p) => p.slug === slug)) {
      queueMicrotask(() => {
        setSelectedSlug(slug);
        setInitialSlug(slug);
      });
    }
  }, [initialProperties]);

  // Keep the URL shareable.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedSlug) url.searchParams.set("p", selectedSlug);
    else url.searchParams.delete("p");
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, [selectedSlug]);

  // Live refresh once a real backend is connected.
  useEffect(() => {
    if (usingMockApi) return;
    const id = setInterval(() => {
      api.getProperties().then(setProperties).catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const select = useCallback((slug: string | null) => {
    setSelectedSlug(slug);
    if (slug) setFocusRequest((n) => n + 1);
  }, []);

  const selectFromList = useCallback(
    (slug: string) => {
      select(slug);
      setMobileView("map");
    },
    [select],
  );

  // Fly the camera once the overlay insets for this selection are in place.
  useEffect(() => {
    if (!focusRequest || !selected?.location) return;
    mapRef.current?.focus(selected.location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // If filters hide the selected property, close its preview.
  useEffect(() => {
    if (selectedSlug && !visible.some((p) => p.slug === selectedSlug)) {
      queueMicrotask(() => setSelectedSlug(null));
    }
  }, [visible, selectedSlug]);

  const sheetHeight = Math.round(viewportHeight * 0.46);
  const insets: Insets = selected
    ? isDesktop
      ? { right: PANEL_WIDTH + 12, bottom: 0 }
      : mobileView === "map"
        ? { right: 0, bottom: sheetHeight }
        : { right: 0, bottom: 0 }
    : { right: 0, bottom: 0 };

  const initialLocation = useMemo(
    () => properties.find((p) => p.slug === initialSlug)?.location ?? null,
    [properties, initialSlug],
  );

  return (
    <div className="relative flex min-h-0 flex-1">
      <aside className="hidden w-[clamp(320px,27vw,420px)] shrink-0 border-r border-white/10 bg-sidebar lg:block">
        <ListingSidebar
          visible={visible}
          total={properties.length}
          filters={filters}
          onFiltersChange={setFilters}
          selectedSlug={selectedSlug}
          hoveredSlug={hoveredSlug}
          onSelect={select}
          onHover={setHoveredSlug}
        />
      </aside>

      <main className="relative min-w-0 flex-1" aria-label="Property map">
        <LeonidaMap
          apiRef={mapRef}
          className="absolute inset-0"
          properties={visible}
          selectedSlug={selectedSlug}
          hoveredSlug={hoveredSlug}
          onSelect={select}
          onHover={setHoveredSlug}
          insets={insets}
          topOffset={isDesktop ? 0 : 56}
          initialFocus={initialLocation}
        >
          {/* Desktop preview panel */}
          <AnimatePresence>
            {isDesktop && selected && (
              <motion.aside
                key="panel"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className="scrollbar-thin absolute top-3 right-3 bottom-3 z-40 overflow-y-auto rounded-xl border border-white/10 bg-[#101014]/95 shadow-2xl shadow-black/60 backdrop-blur-md"
                style={{ width: PANEL_WIDTH }}
              >
                <PropertyPreview key={selected.slug} property={selected} onClose={() => select(null)} />
              </motion.aside>
            )}
          </AnimatePresence>
        </LeonidaMap>

        {/* Mobile: floating search */}
        {!isDesktop && mobileView === "map" && (
          <div className="absolute inset-x-3 top-3 z-40">
            <SearchBox filters={filters} onChange={setFilters} className="shadow-lg shadow-black/40" />
          </div>
        )}

        {/* Mobile: list view */}
        {!isDesktop && mobileView === "list" && (
          <div className="absolute inset-0 z-40 bg-background">
            <ListingSidebar
              visible={visible}
              total={properties.length}
              filters={filters}
              onFiltersChange={setFilters}
              selectedSlug={selectedSlug}
              hoveredSlug={hoveredSlug}
              onSelect={selectFromList}
              onHover={setHoveredSlug}
              className="pb-20"
            />
          </div>
        )}

        {/* Mobile: map / list toggle */}
        {!isDesktop && (
          <button
            type="button"
            onClick={() => setMobileView((v) => (v === "map" ? "list" : "map"))}
            className="absolute left-1/2 z-50 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-sunset-gradient px-5 text-sm font-extrabold text-ink shadow-xl shadow-black/50 transition-[bottom] duration-300"
            style={{ bottom: (mobileView === "map" && selected ? sheetHeight : 0) + 16 }}
          >
            {mobileView === "map" ? (
              <>
                <List className="size-4" /> List ({visible.length})
              </>
            ) : (
              <>
                <MapIcon className="size-4" /> Map
              </>
            )}
          </button>
        )}

        {/* Mobile: bottom sheet */}
        <AnimatePresence>
          {!isDesktop && mobileView === "map" && selected && (
            <motion.div
              key="sheet"
              role="dialog"
              aria-label={`${selected.name} details`}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 90 || info.velocity.y > 600) select(null);
              }}
              className="absolute inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-white/10 bg-[#101014] shadow-[0_-12px_40px_rgba(0,0,0,0.6)]"
              style={{ height: sheetHeight }}
            >
              <div className="flex shrink-0 justify-center pt-2 pb-1">
                <span className="h-1 w-10 rounded-full bg-white/25" aria-hidden />
              </div>
              <div className={cn("scrollbar-thin min-h-0 flex-1 overflow-y-auto")} onPointerDown={(e) => e.stopPropagation()}>
                <PropertyPreview key={selected.slug} property={selected} onClose={() => select(null)} compact />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
