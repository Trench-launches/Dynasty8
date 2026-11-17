"use client";

import Link from "next/link";
import { ArrowRight, MapPin, X } from "lucide-react";
import type { Property } from "@/data/types";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PropertyArt } from "./property-art";
import { TokenStats } from "./token-stats";
import { PriceChart } from "./price-chart";
import { ContractAddress } from "./contract-address";
import { TokenEmblem } from "./token-emblem";

/** Detailed preview shown when a property is selected (side panel on desktop, bottom sheet on mobile). */
export function PropertyPreview({ property: p, onClose }: { property: Property; onClose: () => void }) {
  return (
    <div className="flex flex-col">
      <div className="relative h-44 shrink-0 overflow-hidden sm:h-48">
        <PropertyArt art={p.art} seed={p.slug} title={`${p.name} illustration`} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-3 top-3 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-white/90 text-violet shadow hover:bg-white"
        >
          <X className="size-4" />
        </button>
        <div className="absolute bottom-3 left-3 flex gap-1.5">
          <Badge variant="dark">{p.category}</Badge>
          <Badge className="bg-white/90">{p.neighbourhood}</Badge>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <h2 className="font-display text-2xl leading-tight tracking-wide text-violet">{p.name}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-violet/60">
            <MapPin className="size-3.5" aria-hidden /> {p.location}, {p.neighbourhood}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-violet/80">{p.description}</p>
        </div>

        <div className="flex items-center gap-2">
          <TokenEmblem ticker={p.market.ticker} />
          <div>
            <p className="text-sm font-extrabold text-violet">${p.market.ticker}</p>
            <p className="text-[11px] text-violet/55">Independent Pump.fun-style property token</p>
          </div>
        </div>

        <TokenStats market={p.market} compact />
        <div className="rounded-xl bg-white p-2 ring-1 ring-violet/8">
          <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-violet/55">24h price · demo series</p>
          <PriceChart market={p.market} variant="mini" />
        </div>
        <ContractAddress token={p.token} />

        <Link href={`/property/${p.slug}`} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
          View Market <ArrowRight />
        </Link>
      </div>
    </div>
  );
}
