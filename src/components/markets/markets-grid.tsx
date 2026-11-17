"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { PropertyMarketCard } from "@/components/markets/property-market-card";
import type { Property } from "@/lib/types";

type SortKey = "market_cap" | "price" | "change" | "volume" | "name";

const SORTS: { key: SortKey; label: string; value: (p: Property) => number | string | null | undefined }[] = [
  { key: "market_cap", label: "Market cap", value: (p) => p.market?.marketCapUsd },
  { key: "price", label: "Price", value: (p) => p.market?.priceUsd },
  { key: "change", label: "24h", value: (p) => p.market?.change24hPct },
  { key: "volume", label: "Volume 24h", value: (p) => p.market?.volume24hUsd },
  { key: "name", label: "Name", value: (p) => p.name },
];

/** All property tokens as listing cards. Tokens without market data always sort last. */
export function MarketsGrid({ properties }: { properties: Property[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "market_cap", dir: -1 });

  const cards = useMemo(() => {
    const get = SORTS.find((s) => s.key === sort.key)!.value;
    return [...properties].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return (a.priority ?? 99) - (b.priority ?? 99);
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(String(vb)) : va - Number(vb);
      return cmp * sort.dir;
    });
  }, [properties, sort]);

  return (
    <section aria-label="Property tokens" className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort properties">
        <span className="mr-1 text-[11px] font-semibold tracking-[0.14em] text-[#868e96] uppercase">Sort by</span>
        {SORTS.map(({ key, label }) => {
          const active = sort.key === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === "name" ? 1 : -1 }))
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-d8-green bg-d8-green text-white"
                  : "border-[#ced4da] bg-white text-[#495057] hover:border-d8-green hover:text-d8-green",
              )}
            >
              {label}
              {active && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {cards.map((p) => (
          <PropertyMarketCard key={p.slug} property={p} />
        ))}
      </div>
    </section>
  );
}
