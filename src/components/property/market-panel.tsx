"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Copy, ExternalLink, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useMarket } from "@/hooks/use-market";
import { formatCount, formatPrice, formatUsdCompact, tickerLabel } from "@/lib/format";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import type { ChartPoint, ChartRange, Property } from "@/lib/types";

const RANGES: ChartRange[] = ["24h", "7d", "30d"];

export function MarketPanel({ property }: { property: Property }) {
  const { market, status } = useMarket(property.slug, property.market);
  const token = property.token;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#dee2e6] bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#868e96] uppercase">Property token</p>
            <p className="font-display text-4xl leading-none text-lime">{tickerLabel(property)}</p>
          </div>
          <div className="flex items-center gap-2">
            <MarketDataTag market={market} />
            <TokenStatusBadge status={token.status} />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Price" value={formatPrice(market?.priceUsd)} />
          <Stat label="Market cap" value={formatUsdCompact(market?.marketCapUsd)} />
          <Stat label="24h change" value={<ChangeText value={market?.change24hPct} />} />
          <Stat label="24h volume" value={formatUsdCompact(market?.volume24hUsd)} />
          <Stat label="Holders" value={formatCount(market?.holders)} />
          <Stat label="Launched" value={token.launchedAt ? new Date(token.launchedAt).toLocaleDateString() : "—"} />
        </dl>
        {!market && (
          <p className="mt-3 text-sm text-[#6c757d]">
            {status === "loading"
              ? "Checking market…"
              : status === "error"
                ? "Market data is temporarily unavailable."
                : "No market yet. Figures appear here once the token is live and verified."}
          </p>
        )}
        {market?.source === "demo" && (
          <p className="mt-3 text-xs text-neon">Demo mode: these figures are generated for design preview and are not real.</p>
        )}
        {market?.stale && (
          <p className="mt-3 text-xs text-amber-200">
            Market data is delayed. Last updated {new Date(market.updatedAt).toLocaleString()}.
          </p>
        )}

        <MintRow property={property} />
      </section>

      <PriceChart property={property} live={Boolean(market)} />
    </div>
  );
}

function MintRow({ property }: { property: Property }) {
  const { mint, mintVerified, pumpFunUrl } = property.token;
  const [copied, setCopied] = useState(false);
  const verified = Boolean(mint && mintVerified);

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-[#dee2e6] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] tracking-[0.18em] text-[#868e96] uppercase">Verified mint address</p>
        {verified ? (
          <div className="mt-1 flex items-center gap-2">
            <code className="truncate font-mono text-xs text-[#212529]">{mint}</code>
            <button
              type="button"
              aria-label="Copy mint address"
              onClick={() => {
                navigator.clipboard.writeText(mint!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="grid size-7 shrink-0 place-items-center rounded-md border border-[#dee2e6] text-[#6c757d] hover:text-[#212529]"
            >
              {copied ? <Check className="size-3.5 text-d8-green" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-[#6c757d]">Pending verification — never trust an unverified mint.</p>
        )}
      </div>
      {verified && pumpFunUrl ? (
        <a
          href={pumpFunUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded bg-sunset-gradient px-6 text-[15px] font-bold text-ink transition-transform hover:scale-[1.02]"
        >
          Trade on Pump.fun <ExternalLink className="size-4" />
        </a>
      ) : (
        <span className="inline-flex h-11 shrink-0 items-center justify-center rounded border-[1.5px] border-dashed border-[#ced4da] px-6 text-xs font-semibold text-[#868e96]">
          Pump.fun link pending
        </span>
      )}
    </div>
  );
}

function PriceChart({ property, live }: { property: Property; live: boolean }) {
  const [range, setRange] = useState<ChartRange>("24h");
  const [state, setState] = useState<{ key: string; points: ChartPoint[] | null; error: boolean }>({
    key: "",
    points: null,
    error: false,
  });
  const key = `${property.slug}:${range}`;

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    api
      .getPropertyChart(property.slug, range)
      .then((points) => !cancelled && setState({ key, points, error: false }))
      .catch(() => !cancelled && setState({ key, points: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [property.slug, range, live, key]);

  const loading = live && state.key !== key;
  const points = state.key === key ? state.points : null;

  return (
    <section className="rounded-2xl border border-[#dee2e6] bg-card p-5" aria-label="Price history">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-cream">Price history</h2>
        <div className="flex rounded-full border border-[#dee2e6] bg-[#f8f9fa] p-0.5" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              disabled={!live}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-40",
                range === r ? "bg-[#e9ecef] text-[#212529]" : "text-[#6c757d] hover:text-[#212529]",
              )}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-64">
        {!live ? (
          <EmptyChart text="The chart appears once the token is live." />
        ) : loading ? (
          <div className="h-full animate-pulse rounded-xl bg-[#f8f9fa]" />
        ) : state.error ? (
          <EmptyChart text="Chart data is temporarily unavailable." />
        ) : !points?.length ? (
          <EmptyChart text="No trades in this range yet." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#18713c" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#18713c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e9ecef" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t: string) =>
                  range === "24h"
                    ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : new Date(t).toLocaleDateString([], { day: "numeric", month: "short" })
                }
                tick={{ fill: "#6c757d", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                dataKey="priceUsd"
                tickFormatter={(v: number) => formatPrice(v)}
                tick={{ fill: "#6c757d", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={78}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{ background: "#ffffff", border: "1px solid #dee2e6", borderRadius: 4 }}
                labelStyle={{ color: "#6c757d" }}
                labelFormatter={(t) => new Date(String(t)).toLocaleString()}
                formatter={(v) => [formatPrice(Number(v)), "Price"]}
              />
              <Area type="monotone" dataKey="priceUsd" stroke="#18713c" strokeWidth={2} fill="url(#chart-fill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#dee2e6] text-sm text-[#868e96]">
      <LineChart className="size-6" />
      {text}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#f8f9fa] px-3 py-2.5">
      <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-[#212529] tabular-nums">{value}</dd>
    </div>
  );
}
