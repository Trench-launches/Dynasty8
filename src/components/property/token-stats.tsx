import type { TokenMarketData } from "@/lib/integrations/types";
import { cn, formatNumber, formatPrice, formatUsdCompact } from "@/lib/utils";
import { Change } from "@/components/ui/change";
import { DemoTag } from "@/components/ui/badge";

export function TokenStats({ market, compact = false }: { market: TokenMarketData; compact?: boolean }) {
  const stats = [
    { label: "Market cap", value: formatUsdCompact(market.marketCapUsd) },
    { label: "Price", value: formatPrice(market.priceUsd) },
    { label: "24h change", value: <Change value={market.change24hPct} /> },
    { label: "24h volume", value: formatUsdCompact(market.volume24hUsd) },
    ...(compact ? [] : [{ label: "Holders", value: formatNumber(market.holders) }]),
  ];
  return (
    <div>
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-white px-3 py-2 ring-1 ring-violet/8">
            <p className="text-[10px] font-bold uppercase tracking-wider text-violet/55">{s.label}</p>
            <p className="text-sm font-extrabold tabular-nums text-violet">{s.value}</p>
          </div>
        ))}
        {!compact && <BondingCurve pct={market.bondingCurvePct} />}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-violet/60">
        <DemoTag />
        <span>Simulated snapshot, not live market data.</span>
      </div>
    </div>
  );
}

export function BondingCurve({ pct }: { pct: number | null }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-violet/8">
      <p className="text-[10px] font-bold uppercase tracking-wider text-violet/55">Bonding curve</p>
      {pct === null ? (
        <p className="text-sm font-extrabold text-violet">Graduated</p>
      ) : (
        <>
          <p className="text-sm font-extrabold tabular-nums text-violet">{pct}%</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-violet/10">
            <div className="h-full rounded-full bg-sunset" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
