"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, REGION_BY_ID } from "@/data/regions";
import { formatPrice, formatUsdCompact, tickerLabel } from "@/lib/format";
import { PropertyArt } from "@/components/property/property-art";
import { ChangeText, DemoTag, TokenStatusBadge } from "@/components/property/badges";
import type { Property } from "@/lib/types";

type Col = "name" | "price" | "market_cap" | "change" | "volume";

const VALUE: Record<Col, (p: Property) => number | string | undefined> = {
  name: (p) => p.name,
  price: (p) => p.market?.priceUsd,
  market_cap: (p) => p.market?.marketCapUsd,
  change: (p) => p.market?.change24hPct,
  volume: (p) => p.market?.volume24hUsd,
};

export function MarketsTable({ properties }: { properties: Property[] }) {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "market_cap", dir: -1 });

  const rows = useMemo(() => {
    const get = VALUE[sort.col];
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

  const header = (col: Col, label: string, align: "left" | "right" = "right") => {
    const active = sort.col === col;
    return (
      <th scope="col" className={cn("px-3 py-3 font-semibold", align === "right" ? "text-right" : "text-left")} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ col, dir: s.col === col ? ((s.dir * -1) as 1 | -1) : col === "name" ? 1 : -1 }))}
          className={cn("inline-flex items-center gap-1 tracking-[0.14em] uppercase hover:text-white", active ? "text-white" : "text-white/45")}
        >
          {label}
          {active && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-white/10 text-[11px]">
          <tr>
            {header("name", "Property", "left")}
            <th scope="col" className="px-3 py-3 text-left font-semibold tracking-[0.14em] text-white/45 uppercase">Token</th>
            {header("price", "Price")}
            {header("market_cap", "Market cap")}
            {header("change", "24h")}
            {header("volume", "Volume 24h")}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.slug} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
              <td className="px-3 py-2.5">
                <Link href={`/property/${p.slug}`} className="flex items-center gap-3 outline-none focus-visible:underline">
                  <span className="block h-10 w-14 shrink-0 overflow-hidden rounded-md">
                    <PropertyArt property={p} className="h-full w-full" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-lg leading-tight tracking-wide text-white">{p.name}</span>
                    <span className="block truncate text-[11px] text-white/45">
                      {REGION_BY_ID[p.region]?.name} · {CATEGORY_LABELS[p.category]}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-tropic">{tickerLabel(p)}</span>
                  <TokenStatusBadge status={p.token.status} />
                  <DemoTag market={p.market} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right text-white/85 tabular-nums">{formatPrice(p.market?.priceUsd)}</td>
              <td className="px-3 py-2.5 text-right text-white/85 tabular-nums">{formatUsdCompact(p.market?.marketCapUsd)}</td>
              <td className="px-3 py-2.5 text-right">
                <ChangeText value={p.market?.change24hPct} />
              </td>
              <td className="px-3 py-2.5 text-right text-white/85 tabular-nums">{formatUsdCompact(p.market?.volume24hUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
