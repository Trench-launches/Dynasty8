"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, MapPin } from "lucide-react";
import type { Property } from "@/data/types";
import { formatUsdCompact } from "@/lib/utils";
import { Change } from "@/components/ui/change";
import { PropertyArt } from "./property-art";

export function GridCard({ property: p, onShowOnMap }: { property: Property; onShowOnMap: () => void }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="group flex flex-col overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-violet/8 transition-shadow hover:shadow-[0_18px_40px_-18px_rgba(48,32,79,0.55)]"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
          <PropertyArt art={p.art} seed={p.slug} title={`${p.name} illustration`} />
        </div>
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-violet">
          {p.category}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-midnight px-2 py-0.5 text-[11px] font-extrabold text-cream">
          ${p.market.ticker}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-xl tracking-wide text-violet">{p.name}</h3>
        <p className="flex items-center gap-1 text-xs font-semibold text-violet/60">
          <MapPin className="size-3" aria-hidden /> {p.neighbourhood}
        </p>
        <p className="mt-2 line-clamp-2 text-sm text-violet/80">{p.tagline}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-cream/70 p-2 text-xs">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wide text-violet/45">Mcap</p>
            <p className="font-extrabold text-violet">{formatUsdCompact(p.market.marketCapUsd)}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wide text-violet/45">24h</p>
            <Change value={p.market.change24hPct} className="text-xs" />
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wide text-violet/45">Vol</p>
            <p className="font-extrabold text-violet">{formatUsdCompact(p.market.volume24hUsd)}</p>
          </div>
        </div>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#9a4a10]">Demo data</p>
        <div className="mt-auto flex gap-2 pt-3">
          <button
            type="button"
            onClick={onShowOnMap}
            className="flex-1 cursor-pointer rounded-xl px-3 py-2 text-xs font-extrabold text-violet ring-1 ring-violet/15 hover:text-sunset hover:ring-sunset"
          >
            Show on map
          </button>
          <Link
            href={`/property/${p.slug}`}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-sunset px-3 py-2 text-xs font-extrabold text-white"
          >
            View Property <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}
