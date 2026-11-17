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
      <section className="rounded-2xl border border-white/10 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-white/45 uppercase">Property token</p>
            <p className="font-display text-5xl leading-none text-lime">{tickerLabel(property)}</p>
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
          <p className="mt-3 text-sm text-white/55">
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
    <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] tracking-[0.18em] text-white/45 uppercase">Verified mint address</p>
        {verified ? (
          <div className="mt-1 flex items-center gap-2">
            <code className="truncate font-mono text-xs text-white/80">{mint}</code>
            <button
              type="button"
              aria-label="Copy mint address"
              onClick={() => {
                navigator.clipboard.writeText(mint!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 text-white/60 hover:text-white"
            >
              {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-white/55">Pending verification — never trust an unverified mint.</p>
        )}
      </div>
      {verified && pumpFunUrl ? (
        <a
          href={pumpFunUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-sunset-gradient px-6 text-[15px] font-bold text-ink transition-transform hover:scale-[1.02]"
        >
          Trade on Pump.fun <ExternalLink className="size-4" />
        </a>
      ) : (
        <span className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-white/25 px-6 text-xs font-semibold text-white/45">
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
    <section className="rounded-2xl border border-white/10 bg-card p-5" aria-label="Price history">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[28px] text-cream">Price history</h2>
        <div className="flex rounded-full border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              disabled={!live}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-40",
                range === r ? "bg-white/15 text-white" : "text-white/55 hover:text-white",
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
          <div className="h-full animate-pulse rounded-xl bg-white/[0.04]" />
        ) : state.error ? (
          <EmptyChart text="Chart data is temporarily unavailable." />
        ) : !points?.length ? (
          <EmptyChart text="No trades in this range yet." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff6b9d" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#ff6b9d" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t: string) =>
                  range === "24h"
                    ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : new Date(t).toLocaleDateString([], { day: "numeric", month: "short" })
                }
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                dataKey="priceUsd"
                tickFormatter={(v: number) => formatPrice(v)}
                tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={78}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{ background: "#1c1d35", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                labelFormatter={(t) => new Date(String(t)).toLocaleString()}
                formatter={(v) => [formatPrice(Number(v)), "Price"]}
              />
              <Area type="monotone" dataKey="priceUsd" stroke="#ff6b9d" strokeWidth={2} fill="url(#chart-fill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 text-sm text-white/45">
      <LineChart className="size-6" />
      {text}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-black/25 px-3 py-2.5">
      <dt className="text-[10px] tracking-wider text-white/45 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-white tabular-nums">{value}</dd>
    </div>
  );
}
