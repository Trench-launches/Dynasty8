"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { SearchX } from "lucide-react";
import type { Property } from "@/data/types";
import { brand } from "@/config/brand";
import { applyFilters, DEFAULT_FILTERS, type PropertyFilters } from "@/lib/data";
import { PropertyMap, type FocusRequest } from "@/components/map/property-map";
import { ListingCard } from "@/components/property/listing-card";
import { GridCard } from "@/components/property/grid-card";
import { PropertyPreview } from "@/components/property/property-preview";
import { Button } from "@/components/ui/button";
import { DemoTag } from "@/components/ui/badge";
import { FilterBar, type ViewMode } from "./filter-bar";

function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

/** Keep `?view=` and `?property=` in the URL without a navigation. */
function writeUrl(view: ViewMode, slug: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (view === "grid") params.set("view", "grid");
  else params.delete("view");
  if (slug) params.set("property", slug);
  else params.delete("property");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-violet/15 bg-white/60 px-6 py-12 text-center">
      <SearchX className="size-10 text-sunset" aria-hidden />
      <p className="mt-3 font-display text-xl tracking-wide text-violet">No properties match</p>
      <p className="mt-1 max-w-xs text-sm text-violet/65">
        Nothing on the market fits those filters. Try another neighbourhood or clear the search.
      </p>
      <Button variant="outline" className="mt-4" onClick={onReset}>
        Clear filters
      </Button>
    </div>
  );
}

export function Marketplace({ properties }: { properties: Property[] }) {
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();
  const view: ViewMode = searchParams.get("view") === "grid" ? "grid" : "map";
  const urlSlug = searchParams.get("property");

  const [filters, setFilters] = useState<PropertyFilters>(DEFAULT_FILTERS);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    urlSlug && properties.some((p) => p.slug === urlSlug) ? urlSlug : null,
  );
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(
    selectedSlug ? { slug: selectedSlug, nonce: 1 } : null,
  );
  const listingRefs = useRef(new Map<string, HTMLElement>());
  const sheetDrag = useDragControls();
  const mapSectionRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => applyFilters(properties, filters), [properties, filters]);
  const selected = filtered.find((p) => p.slug === selectedSlug) ?? null;

  const select = useCallback(
    (slug: string, zoom: number) => {
      setSelectedSlug(slug);
      setFocus((f) => ({ slug, zoom, nonce: (f?.nonce ?? 0) + 1 }));
      writeUrl(view, slug);
    },
    [view],
  );

  const clearSelection = useCallback(() => {
    setSelectedSlug(null);
    writeUrl(view, null);
  }, [view]);

  const setView = (v: ViewMode) => writeUrl(v, selectedSlug);

  // Keep the selected listing visible in the sidebar.
  useEffect(() => {
    if (!selectedSlug) return;
    listingRefs.current.get(selectedSlug)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // On phones, bring the map to the top so the marker shows above the bottom sheet.
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      mapSectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [selectedSlug]);

  // Escape closes the preview.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearSelection();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, clearSelection]);

  const focusOffset = isDesktop ? { x: -200, y: 0 } : { x: 0, y: -125 };

  const map = (
    <PropertyMap
      properties={filtered}
      selectedSlug={selected?.slug ?? null}
      hoveredSlug={hoveredSlug}
      onSelect={(slug) => select(slug, 1.6)}
      onHover={setHoveredSlug}
      focus={focus}
      focusOffsetPx={focusOffset}
    />
  );

  const toolbar = (
    <FilterBar
      filters={filters}
      onChange={setFilters}
      view={view}
      onViewChange={setView}
      resultCount={filtered.length}
    />
  );

  if (view === "grid") {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-5 lg:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.3em] text-sunset">{brand.city} listings</p>
            <h1 className="font-display text-3xl tracking-wide text-violet sm:text-4xl">{brand.tagline}</h1>
          </div>
          <DemoTag label="All figures are demo data" />
        </div>
        {toolbar}
        <div className="mt-5">
          {filtered.length === 0 ? (
            <EmptyState onReset={() => setFilters(DEFAULT_FILTERS)} />
          ) : (
            <motion.div layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <AnimatePresence mode="popLayout">
                {filtered.map((p) => (
                  <GridCard
                    key={p.slug}
                    property={p}
                    onShowOnMap={() => {
                      writeUrl("map", p.slug);
                      setSelectedSlug(p.slug);
                      setFocus((f) => ({ slug: p.slug, nonce: (f?.nonce ?? 0) + 1 }));
                    }}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-3 pb-3 pt-3 lg:h-[calc(100dvh-96px)] lg:px-6 lg:pb-5">
      {toolbar}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[400px_1fr] xl:grid-cols-[440px_1fr]">
        {/* Listings column (desktop) */}
        <section aria-label="Property listings" className="hidden min-h-0 flex-col overflow-hidden rounded-3xl bg-white/60 ring-1 ring-violet/8 lg:flex">
          <div className="bg-sunset px-4 py-3 text-white">
            <p className="font-display text-xl tracking-wide">{brand.tagline}</p>
            <p className="text-xs font-semibold text-white/85">
              {filtered.length} {filtered.length === 1 ? "property" : "properties"} on the market · demo data
            </p>
          </div>
          <div className="scroll-slim flex-1 space-y-3 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <EmptyState onReset={() => setFilters(DEFAULT_FILTERS)} />
            ) : (
              filtered.map((p) => (
                <ListingCard
                  key={p.slug}
                  ref={(el) => {
                    if (el) listingRefs.current.set(p.slug, el);
                    else listingRefs.current.delete(p.slug);
                  }}
                  property={p}
                  selected={p.slug === selected?.slug}
                  hovered={p.slug === hoveredSlug}
                  onSelect={() => select(p.slug, 2.4)}
                  onHover={(on) => setHoveredSlug(on ? p.slug : null)}
                />
              ))
            )}
          </div>
        </section>

        {/* Map column */}
        <section
          ref={mapSectionRef}
          aria-label="Property map"
          className="relative h-[calc(100dvh-260px)] min-h-[420px] scroll-mt-[72px] overflow-hidden rounded-3xl shadow-[0_20px_50px_-25px_rgba(48,32,79,0.6)] ring-4 ring-white lg:h-auto lg:min-h-0"
        >
          {map}
          {/* Desktop preview panel */}
          <AnimatePresence>
            {isDesktop && selected && (
              <motion.aside
                key={selected.slug}
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 40, opacity: 0 }}
                transition={{ type: "spring", damping: 28, stiffness: 300 }}
                aria-label={`${selected.name} preview`}
                className="scroll-slim absolute bottom-3 right-3 top-3 z-50 w-[380px] overflow-y-auto rounded-2xl bg-cream shadow-2xl ring-1 ring-violet/10"
              >
                <PropertyPreview property={selected} onClose={clearSelection} />
              </motion.aside>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Mobile bottom sheet */}
      <AnimatePresence>
        {!isDesktop && selected && (
          <motion.div
            key="sheet"
            role="dialog"
            aria-label={`${selected.name} preview`}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragControls={sheetDrag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) clearSelection();
            }}
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[54dvh] overflow-hidden rounded-t-3xl bg-cream shadow-[0_-20px_50px_-20px_rgba(21,21,46,0.6)]"
          >
            <div
              className="flex cursor-grab touch-none justify-center py-2.5"
              onPointerDown={(e) => sheetDrag.start(e)}
            >
              <span className="h-1.5 w-12 rounded-full bg-violet/25" aria-hidden />
            </div>
            <div className="max-h-[calc(54dvh-26px)] overflow-y-auto overscroll-contain">
              <PropertyPreview property={selected} onClose={clearSelection} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
