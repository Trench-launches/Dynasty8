import { MOCK_PROPERTIES } from "@/data/properties";
import type {
  ChartPoint,
  ChartRange,
  ChartSeries,
  EcosystemMarkets,
  EcosystemToken,
  MarketSnapshot,
  Property,
} from "@/lib/types";

/**
 * In-memory stand-in for the backend, used when NEXT_PUBLIC_MOCK_API=true
 * (UI work without a database). Returns the same view models as the real adapter.
 *
 * Default: every token is "coming_soon" with no market data.
 * NEXT_PUBLIC_DEMO_MARKETS=true: some tokens get generated market numbers with
 * `source: "demo"` so designers can see populated states. The UI labels every
 * demo figure; never ship demo mode to production.
 */

export const DEMO_MARKETS = process.env.NEXT_PUBLIC_DEMO_MARKETS === "true";

/** Fixed so server and client renders agree. */
const DEMO_UPDATED_AT = "2026-01-01T00:00:00.000Z";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoMarket(slug: string): MarketSnapshot {
  const r = rng(hash(slug));
  const marketCapUsd = Math.round(8_000 + r() ** 2.2 * 2_400_000);
  const supply = 1_000_000_000; // Pump.fun standard supply
  return {
    priceUsd: marketCapUsd / supply,
    marketCapUsd,
    volume24hUsd: Math.round(marketCapUsd * (0.05 + r() * 0.9)),
    change24hPct: Math.round((r() * 160 - 40) * 10) / 10,
    holders: Math.round(40 + r() * 3000),
    updatedAt: DEMO_UPDATED_AT,
    source: "demo",
    stale: false,
  };
}

function withDemoState(p: Property): Property {
  if (!DEMO_MARKETS) return p;
  if (p.slug === "shorecourt-garage") {
    return { ...p, token: { ...p.token, status: "unavailable" } };
  }
  const live = (p.priority ?? 0) % 3 !== 0;
  if (!live) return p;
  return {
    ...p,
    token: { ...p.token, status: "live", launchedAt: DEMO_UPDATED_AT },
    market: demoMarket(p.slug),
  };
}

const PROPERTIES = MOCK_PROPERTIES.map(withDemoState);

const ECOSYSTEM: EcosystemToken = {
  name: "Dynasty",
  ticker: "DYNASTY",
  status: DEMO_MARKETS ? "live" : "coming_soon",
  mint: null,
  mintVerified: false,
  pumpFunUrl: null,
  summary:
    "DYNASTY is the planned ecosystem token for the DYNASTY marketplace. It is separate from the individual property tokens, and property-token trading fees do not automatically flow to it.",
  market: DEMO_MARKETS ? demoMarket("realty-ecosystem") : null,
};

/** Simulated latency in the browser only, so loading states can be seen. */
function respond<T>(value: T): Promise<T> {
  if (typeof window === "undefined") return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), 250));
}

const RANGE_POINTS: Record<ChartRange, { points: number; stepMs: number; interval: string }> = {
  "24h": { points: 48, stepMs: 30 * 60 * 1000, interval: "30m" },
  "7d": { points: 84, stepMs: 2 * 60 * 60 * 1000, interval: "2h" },
  "30d": { points: 90, stepMs: 8 * 60 * 60 * 1000, interval: "8h" },
};

function demoChart(property: Property, range: ChartRange): ChartPoint[] {
  const { priceUsd, volume24hUsd, change24hPct } = property.market ?? {};
  if (priceUsd == null || volume24hUsd == null) return [];
  const { points, stepMs } = RANGE_POINTS[range];
  const r = rng(hash(`${property.slug}:${range}`));
  const end = Date.now();
  const series: ChartPoint[] = [];
  // Walk backwards from the current price so the series ends at the snapshot value.
  let price = priceUsd;
  for (let i = 0; i < points; i++) {
    series.unshift({
      t: new Date(end - i * stepMs).toISOString(),
      priceUsd: price,
      volumeUsd: Math.round((volume24hUsd / points) * (0.3 + r() * 1.4)),
    });
    price = Math.max(price * (1 + (r() - 0.52) * 0.12), 1e-9);
  }
  // Keep the demo 24H chart in step with the demo "24h change" figure shown beside it:
  // bend the walk so it starts where that change implies, still ending at the current price.
  if (range === "24h" && change24hPct != null && change24hPct > -100 && series.length > 1) {
    const ratio = priceUsd / (1 + change24hPct / 100) / series[0].priceUsd;
    const last = series.length - 1;
    series.forEach((p, i) => {
      p.priceUsd *= ratio ** (1 - i / last);
    });
  }
  return series;
}

export const mockApi = {
  getProperties(): Promise<Property[]> {
    return respond(PROPERTIES);
  },
  getProperty(slug: string): Promise<Property | null> {
    return respond(PROPERTIES.find((p) => p.slug === slug) ?? null);
  },
  getPropertyMarket(slug: string): Promise<MarketSnapshot | null> {
    return respond(PROPERTIES.find((p) => p.slug === slug)?.market ?? null);
  },
  getPropertyChart(slug: string, range: ChartRange): Promise<ChartSeries> {
    const p = PROPERTIES.find((x) => x.slug === slug);
    const points = p ? demoChart(p, range) : [];
    return respond({
      points,
      unavailableReason: points.length ? null : "not_launched",
      interval: points.length ? RANGE_POINTS[range].interval : null,
      source: points.length ? "demo" : null,
      fetchedAt: new Date().toISOString(),
    });
  },
  getEcosystem(): Promise<EcosystemToken> {
    return respond(ECOSYSTEM);
  },
  getEcosystemMarkets(): Promise<EcosystemMarkets> {
    const live = PROPERTIES.filter((p) => p.market);
    const sum = (pick: (m: MarketSnapshot) => number | null) =>
      live.length ? live.reduce((s, p) => s + (pick(p.market!) ?? 0), 0) : null;
    return respond({
      liveTokens: PROPERTIES.filter((p) => p.token.status === "live").length,
      totalListings: PROPERTIES.length,
      totalMarketCapUsd: sum((m) => m.marketCapUsd),
      totalVolume24hUsd: sum((m) => m.volume24hUsd),
      source: live.length ? "demo" : null,
    });
  },
};
