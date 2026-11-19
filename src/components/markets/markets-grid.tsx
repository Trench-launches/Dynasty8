"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PropertyMarketCard } from "@/components/markets/property-market-card";
import { choiceBox } from "@/components/ui/panel";
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
    <section aria-label="Property tokens" className="space-y-5">
      <div className="space-y-2.5">
        <p id="sort-label" className="text-[15px] font-bold tracking-[0.06em] text-vc-text uppercase">
          Sort by
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="sort-label">
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
                className={choiceBox(active)}
              >
                {label}
                {active && (sort.dir === 1 ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-5">
        {cards.map((p) => (
          <PropertyMarketCard key={p.slug} property={p} />
        ))}
      </div>
    </section>
  );
}
