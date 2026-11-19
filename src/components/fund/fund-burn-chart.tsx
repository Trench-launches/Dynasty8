"use client";

import { Flame } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatFundDate, formatTokenAmount } from "@/lib/fund-format";
import type { FundBurnDto } from "@/contracts/demolition-fund";
import { PanelHeader } from "@/components/ui/panel";

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
    <section aria-labelledby="fund-burns" className="min-w-0 border border-vc-line bg-vc-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <PanelHeader id="fund-burns" title="Cumulative burns" note="Burn analytics" className="-mx-px -mt-px" />
      <div className="border-b border-vc-line px-4 py-3">
        <p className="text-[13px] tracking-[0.06em] text-vc-muted uppercase">Verified total</p>
        <p className="mt-1 flex items-baseline gap-2 leading-none text-vc-text tabular-nums">
          <span className="text-[30px]">{formatTokenAmount(total, decimals)}</span>
          <span className="text-[15px] text-vc-text-2 uppercase">${ticker}</span>
        </p>
      </div>
      {data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Flame className="size-8 text-vc-faint" aria-hidden />
          <p className="font-semibold text-vc-text-2">No burns yet</p>
          <p className="max-w-xs text-xs text-vc-faint">Every ${ticker} the fund buys back is burned; verified burns will chart here.</p>
        </div>
      ) : (
        <div className="h-56 px-2 py-3 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-vc-line)" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
                tick={{ fontSize: 11, fill: "var(--color-vc-faint)" }}
                stroke="var(--color-vc-line-strong)"
              />
              <YAxis tick={{ fontSize: 11, fill: "var(--color-vc-faint)" }} stroke="var(--color-vc-line-strong)" width={56} tickFormatter={(v: number) => Intl.NumberFormat("en-US", { notation: "compact" }).format(v)} />
              <Tooltip
                contentStyle={{ background: "var(--color-vc-surface)", border: "1px solid var(--color-vc-line)", borderRadius: 4, color: "var(--color-vc-text)" }}
                labelStyle={{ color: "var(--color-vc-muted)" }}
                itemStyle={{ color: "var(--color-vc-text)" }}
                cursor={{ stroke: "var(--color-vc-line-strong)" }}
                formatter={(_v, _n, item) => [`${formatTokenAmount((item.payload as { raw: string }).raw, decimals)} $${ticker}`, "Burned to date"]}
                labelFormatter={(_l, payload) => formatFundDate((payload?.[0]?.payload as { label?: string } | undefined)?.label ?? null)}
              />
              <Area type="stepAfter" dataKey="value" stroke="var(--color-vc-violet)" fill="var(--color-vc-violet)" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
