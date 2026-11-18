"use client";

import { Flame } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFundDate, formatTokenAmount } from "@/lib/fund-format";
import type { FundBurnDto } from "@/contracts/demolition-fund";

interface Props {
  burns: FundBurnDto[];
  ticker: string;
  decimals: number | null;
}

/**
 * Cumulative verified burns over time. Built only from finalized, verified burn transactions;
 * with none yet it shows an empty state instead of a chart.
 */
export function FundBurnChart({ burns, ticker, decimals }: Props) {
  const points = [...burns]
    .filter((b) => b.burnedAt)
    .sort((a, b) => (a.burnedAt! < b.burnedAt! ? -1 : 1))
    .reduce<{ t: number; cumulative: bigint; label: string }[]>((acc, b) => {
      const prev = acc.at(-1)?.cumulative ?? 0n;
      acc.push({ t: new Date(b.burnedAt!).getTime(), cumulative: prev + BigInt(b.dynastyBurnedRaw), label: b.burnedAt! });
      return acc;
    }, []);
  const scale = decimals == null ? 1 : 10 ** decimals;
  const data = points.map((p) => ({ t: p.t, value: Number(p.cumulative) / scale, raw: p.cumulative.toString(), label: p.label }));
  const total = points.at(-1)?.cumulative.toString() ?? "0";

  return (
    <section aria-labelledby="fund-burns" className="min-w-0 rounded-md border border-[#ced4da] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-[#dee2e6] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-[#868e96] uppercase">Burn analytics</p>
          <h2 id="fund-burns" className="font-display text-2xl leading-tight font-bold text-[#212529]">
            Cumulative <span className="text-d8-green">burns</span>
          </h2>
        </div>
        <p className="text-right">
          <span className="block text-[10px] tracking-wider text-[#868e96] uppercase">Verified total</span>
          <span className="text-lg font-semibold text-[#212529] tabular-nums">
            {formatTokenAmount(total, decimals)} ${ticker}
          </span>
        </p>
      </header>
      {data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Flame className="size-8 text-[#adb5bd]" aria-hidden />
          <p className="font-semibold text-[#495057]">No burns yet</p>
          <p className="max-w-xs text-xs text-[#868e96]">Every ${ticker} the fund buys back is burned; verified burns will chart here.</p>
        </div>
      ) : (
        <div className="h-56 px-2 py-3 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e9ecef" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
                tick={{ fontSize: 11, fill: "#868e96" }}
                stroke="#ced4da"
              />
              <YAxis tick={{ fontSize: 11, fill: "#868e96" }} stroke="#ced4da" width={56} tickFormatter={(v: number) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)} />
              <Tooltip
                formatter={(_v, _n, item) => [`${formatTokenAmount((item.payload as { raw: string }).raw, decimals)} $${ticker}`, "Burned to date"]}
                labelFormatter={(_l, payload) => formatFundDate((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? null)}
              />
              <Area type="stepAfter" dataKey="value" stroke="#18713c" fill="#18713c" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
