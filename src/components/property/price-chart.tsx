"use client";

import { useId, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartRange, TokenMarketData } from "@/lib/integrations/types";
import { demoHistory } from "@/lib/integrations/mock";
import { cn, formatPrice } from "@/lib/utils";

const RANGES: ChartRange[] = ["1H", "24H", "7D", "30D"];

function formatTime(t: number, range: ChartRange) {
  const d = new Date(t);
  if (range === "1H" || range === "24H")
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Demo price chart. Data is generated from the mock market, never fetched. */
export function PriceChart({
  market,
  variant = "full",
  className,
}: {
  market: TokenMarketData;
  variant?: "mini" | "full";
  className?: string;
}) {
  const [range, setRange] = useState<ChartRange>("24H");
  const data = useMemo(() => demoHistory(market, range), [market, range]);
  const gid = useId().replace(/:/g, "");
  const first = data[0]?.price ?? 0;
  const lastP = data[data.length - 1]?.price ?? 0;
  const up = lastP >= first;
  const stroke = up ? "#ff6b9d" : "#a45cff";
  const rangePct = first ? ((lastP - first) / first) * 100 : 0;

  return (
    <div className={cn("flex flex-col", className)}>
      {variant === "full" && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-xl bg-violet/6 p-1" role="tablist" aria-label="Chart range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={r === range}
                onClick={() => setRange(r)}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-extrabold transition-colors",
                  r === range ? "bg-white text-sunset shadow" : "text-violet/60 hover:text-violet",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <span className={cn("text-xs font-bold", rangePct >= 0 ? "text-[#0d9a70]" : "text-[#d6304f]")}>
            {rangePct >= 0 ? "+" : ""}
            {rangePct.toFixed(1)}% over {range} · demo series
          </span>
        </div>
      )}
      <div className={variant === "mini" ? "h-24" : "h-64 sm:h-72"}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={stroke} stopOpacity={0.4} />
                <stop offset="1" stopColor="#ffb36b" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {variant === "full" && (
              <>
                <XAxis
                  dataKey="t"
                  tickFormatter={(v: number) => formatTime(v, range)}
                  tick={{ fontSize: 11, fill: "#30204f99" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  dataKey="price"
                  orientation="right"
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => formatPrice(v, 4)}
                  tick={{ fontSize: 11, fill: "#30204f99" }}
                  axisLine={false}
                  tickLine={false}
                  width={86}
                />
              </>
            )}
            {variant === "mini" && <YAxis hide domain={["auto", "auto"]} />}
            <Tooltip
              cursor={{ stroke: "#30204f33" }}
              contentStyle={{
                borderRadius: 12,
                border: "none",
                boxShadow: "0 10px 30px -10px rgba(21,21,46,.45)",
                fontSize: 12,
              }}
              labelFormatter={(v) => `${formatTime(Number(v), range)} UTC (demo)`}
              formatter={(v) => [formatPrice(Number(v), 4), "Price"]}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={stroke}
              strokeWidth={2.4}
              fill={`url(#fill-${gid})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
