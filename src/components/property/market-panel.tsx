"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { Check, Copy, ExternalLink, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useMarket } from "@/hooks/use-market";
import { formatCount, formatPrice, formatUsdCompact, tickerLabel } from "@/lib/format";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import type { ChartPoint, ChartRange, ChartSeries, ChartUnavailableReason, Property } from "@/lib/types";

const RANGES: ChartRange[] = ["24h", "7d", "30d"];
const RANGE_LABEL: Record<ChartRange, string> = { "24h": "24H", "7d": "7D", "30d": "30D" };
/** The server caches history for 5-60 min per range, so a 1-minute refresh keeps an open page current cheaply. */
const CHART_REFRESH_MS = 60_000;
/** Site branding: the Dynasty green (--color-d8-green) for the line; grid one hairline step off the white card. */
const CHART_LINE = "#18713c";
const CHART_GRID = "#e9ecef";
const CHART_AXIS_TEXT = "#6c757d";
const CHART_CURSOR = "#adb5bd";

const UNAVAILABLE_TEXT: Record<ChartUnavailableReason, string> = {
  not_launched: "The chart appears once the token is live.",
  no_pool: "No trading pool found for this token yet.",
  no_history: "No trades in this range yet.",
  provider_unavailable: "Price history is temporarily unavailable.",
  rate_limited: "Price history is busy right now. It refreshes automatically.",
};
const SOURCE_LABEL: Record<string, string> = { birdeye: "Birdeye", dexscreener: "DexScreener" };

type ChartLoad = { slug: string; range: ChartRange; series: ChartSeries | null; error: boolean };

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
          <Stat label="Launched" value={token.launchedAt ? formatLaunchDate(token.launchedAt) : "—"} />
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
            Market data is delayed. Last updated{" "}
            {/* Local time differs between server and browser; let the browser's version stand. */}
            <time dateTime={market.updatedAt} suppressHydrationWarning>
              {new Date(market.updatedAt).toLocaleString()}
            </time>
            .
          </p>
        )}

        <MintRow property={property} />
      </section>

      <PriceChart property={property} />
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

function PriceChart({ property }: { property: Property }) {
  // The backend only serves history for a LIVE token with a verified mint; ask for nothing before that.
  const live = property.token.status === "live";
  const [range, setRange] = useState<ChartRange>("24h");
  const [load, setLoad] = useState<ChartLoad | null>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const fetchSeries = () =>
      api
        .getPropertyChart(property.slug, range)
        .then((series) => {
          if (!cancelled) setLoad({ slug: property.slug, range, series, error: false });
        })
        .catch(() => {
          if (cancelled) return;
          // A failed refresh keeps the chart already on screen; only a failed first load shows an error.
          setLoad((prev) =>
            prev && prev.slug === property.slug && prev.range === range && prev.series
              ? prev
              : { slug: property.slug, range, series: null, error: true },
          );
        });
    fetchSeries();
    const timer = window.setInterval(fetchSeries, CHART_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [property.slug, range, live]);

  const latest = load?.slug === property.slug ? load : null;
  const current = latest?.range === range ? latest : null;
  // While another range loads, the previous chart stays on screen (dimmed) instead of flashing a skeleton.
  const pending = live && !current;
  const shown = latest?.series?.points.length ? latest.series : null;
  const shownRange = latest?.range ?? range;
  const points = shown?.points ?? [];
  const stats = summarise(points);

  return (
    <section className="rounded-2xl border border-[#dee2e6] bg-card p-5" aria-label="Price history">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-cream">Price history</h2>
          {stats && (
            <p className="mt-1 text-sm text-[#6c757d]">
              <ChangeText value={stats.changePct} className="font-semibold" /> over {RANGE_LABEL[shownRange]}
            </p>
          )}
        </div>
        <div className="flex gap-1" role="group" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              disabled={!live}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                range === r
                  ? "border-d8-green bg-d8-green text-white"
                  : "border-[#ced4da] bg-white text-[#495057] hover:border-d8-green hover:text-d8-green",
              )}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-64">
        {!live ? (
          <EmptyChart text={UNAVAILABLE_TEXT.not_launched} />
        ) : shown ? (
          <div className={cn("h-full transition-opacity duration-200", pending && "opacity-50")} aria-busy={pending}>
            <PriceArea points={points} range={shownRange} />
          </div>
        ) : pending ? (
          <div className="h-full animate-pulse rounded-xl bg-[#f8f9fa]" />
        ) : current?.error ? (
          <EmptyChart text={UNAVAILABLE_TEXT.provider_unavailable} />
        ) : (
          <EmptyChart text={UNAVAILABLE_TEXT[current?.series?.unavailableReason ?? "no_history"]} />
        )}
      </div>

      {shown && stats && (
        <>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-[#dee2e6] pt-3 text-xs">
            <dl className="flex flex-wrap gap-x-4 gap-y-1">
              <ChartFigure label="Latest" value={formatPrice(stats.last.priceUsd)} />
              <ChartFigure label={`${RANGE_LABEL[shownRange]} high`} value={formatPrice(stats.high.priceUsd)} />
              <ChartFigure label={`${RANGE_LABEL[shownRange]} low`} value={formatPrice(stats.low.priceUsd)} />
            </dl>
            <p className="text-[11px] text-[#868e96]">{sourceLine(shown)}</p>
          </div>
          {/* Every value on the chart, for screen readers (the tooltip is never the only way to read it). */}
          <table className="sr-only">
            <caption>
              {tickerLabel(property)} price in US dollars, last {RANGE_LABEL[shownRange]}
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}>
                  <td>{formatWhen(p.t)}</td>
                  <td>{formatPrice(p.priceUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/**
 * One series over time: a 2px brand-green line with a 10% wash, hairline grid, price axis on the
 * right, a crosshair tooltip, and a dot on the latest price. No legend: the card title names it.
 */
function PriceArea({ points, range }: { points: ChartPoint[]; range: ChartRange }) {
  const prices = points.map((p) => p.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Breathing room above and below so the line never runs along the card edge.
  const pad = (max - min) * 0.12 || max * 0.05 || 1e-9;
  const last = points[points.length - 1];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 8, right: 0, bottom: 0, left: 4 }} accessibilityLayer>
        <CartesianGrid stroke={CHART_GRID} strokeWidth={1} vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(t: string) => formatTick(t, range)}
          tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
          axisLine={{ stroke: CHART_GRID }}
          tickLine={false}
          tickMargin={8}
          minTickGap={40}
        />
        <YAxis
          orientation="right"
          domain={[Math.max(0, min - pad), max + pad]}
          tickCount={4}
          tickFormatter={(v: number) => formatPrice(v)}
          tick={{ fill: CHART_AXIS_TEXT, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <Tooltip
          cursor={{ stroke: CHART_CURSOR, strokeWidth: 1 }}
          content={(props) => <PriceTooltip {...props} />}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="priceUsd"
          stroke={CHART_LINE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill={CHART_LINE}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, fill: CHART_LINE, stroke: "#ffffff", strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <ReferenceDot x={last.t} y={last.priceUsd} r={4} fill={CHART_LINE} stroke="#ffffff" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Value first, time second, keyed with a short stroke of the line colour. */
function PriceTooltip({ active, payload }: TooltipContentProps) {
  const point = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
  if (!point) return null;
  return (
    <div className="rounded border border-[#dee2e6] bg-white px-3 py-2 shadow-[0_4px_14px_rgba(0,0,0,0.12)]">
      <p className="text-sm font-semibold text-[#212529]">{formatPrice(point.priceUsd)}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#6c757d]">
        <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-d8-green" />
        {formatWhen(point.t)}
      </p>
      {point.volumeUsd != null && (
        <p className="mt-0.5 text-[11px] text-[#868e96]">Volume {formatUsdCompact(point.volumeUsd)}</p>
      )}
    </div>
  );
}

function ChartFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[#868e96]">{label}</dt>
      <dd className="font-semibold text-[#212529] tabular-nums">{value}</dd>
    </div>
  );
}

function summarise(points: ChartPoint[]) {
  if (!points.length) return null;
  let high = points[0];
  let low = points[0];
  for (const p of points) {
    if (p.priceUsd > high.priceUsd) high = p;
    if (p.priceUsd < low.priceUsd) low = p;
  }
  const first = points[0].priceUsd;
  const last = points[points.length - 1];
  return { last, high, low, changePct: first > 0 ? ((last.priceUsd - first) / first) * 100 : null };
}

/**
 * Fixed locale and time zone so the server render and the browser agree (a locale-dependent
 * date here made React discard the server HTML for the whole panel).
 */
function formatLaunchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatTick(iso: string, range: ChartRange): string {
  const d = new Date(iso);
  return range === "24h"
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function sourceLine(series: ChartSeries): string {
  if (series.source === "demo") return "Demo data for design preview";
  const parts = [`Source: ${SOURCE_LABEL[series.source ?? ""] ?? series.source ?? "market data"}`];
  if (series.interval) parts.push(`${series.interval} candles`);
  if (series.fetchedAt) {
    parts.push(`updated ${new Date(series.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  }
  return parts.join(" · ");
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#dee2e6] px-6 text-center text-sm text-[#868e96]">
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
