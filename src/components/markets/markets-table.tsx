"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Property } from "@/data/types";
import { cn, formatNumber, formatPrice, formatUsdCompact } from "@/lib/utils";
import { Change } from "@/components/ui/change";
import { PropertyArt } from "@/components/property/property-art";

type Col = "name" | "price" | "marketCap" | "change" | "volume" | "holders";

const COLS: { key: Col; label: string; align?: "right" }[] = [
  { key: "name", label: "Property token" },
  { key: "price", label: "Price", align: "right" },
  { key: "marketCap", label: "Market cap", align: "right" },
  { key: "change", label: "24h", align: "right" },
  { key: "volume", label: "24h volume", align: "right" },
  { key: "holders", label: "Holders", align: "right" },
];

const value = (p: Property, c: Col): number | string => {
  switch (c) {
    case "name":
      return p.name;
    case "price":
      return p.market.priceUsd;
    case "marketCap":
      return p.market.marketCapUsd;
    case "change":
      return p.market.change24hPct;
    case "volume":
      return p.market.volume24hUsd;
    case "holders":
      return p.market.holders;
  }
};

export function MarketsTable({ properties }: { properties: Property[] }) {
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "marketCap", dir: -1 });
  const rows = useMemo(
    () =>
      [...properties].sort((a, b) => {
        const va = value(a, sort.col);
        const vb = value(b, sort.col);
        const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
        return cmp * sort.dir;
      }),
    [properties, sort],
  );

  return (
    <div className="overflow-x-auto rounded-3xl bg-white ring-1 ring-violet/8">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-violet/8 text-[11px] uppercase tracking-wider text-violet/55">
            <th className="w-10 px-4 py-3 text-left font-bold">#</th>
            {COLS.map((c) => {
              const active = sort.col === c.key;
              return (
                <th
                  key={c.key}
                  aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                  className={cn("px-4 py-3 font-bold", c.align === "right" ? "text-right" : "text-left")}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) => ({ col: c.key, dir: s.col === c.key ? ((s.dir * -1) as 1 | -1) : c.key === "name" ? 1 : -1 }))
                    }
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 uppercase hover:text-violet",
                      active && "text-sunset",
                    )}
                  >
                    {c.label}
                    {active && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.slug} className="border-b border-violet/6 last:border-0 hover:bg-cream/60">
              <td className="px-4 py-3 font-bold text-violet/45">{i + 1}</td>
              <td className="px-4 py-3">
                <Link href={`/property/${p.slug}`} className="flex items-center gap-3 font-bold text-violet hover:text-sunset">
                  <span className="h-10 w-14 shrink-0 overflow-hidden rounded-lg">
                    <PropertyArt art={p.art} seed={p.slug} title={`${p.name} illustration`} />
                  </span>
                  <span>
                    <span className="block">{p.name}</span>
                    <span className="text-xs font-extrabold text-violet/55">${p.market.ticker} · {p.neighbourhood}</span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-violet">{formatPrice(p.market.priceUsd)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-violet">{formatUsdCompact(p.market.marketCapUsd)}</td>
              <td className="px-4 py-3 text-right">
                <Change value={p.market.change24hPct} />
              </td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-violet">{formatUsdCompact(p.market.volume24hUsd)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-violet">{formatNumber(p.market.holders)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
