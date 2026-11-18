import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { PropertyDetailDto } from "@/contracts/api";
import { GET as listRoute } from "@/app/api/properties/route";
import { GET as detailRoute } from "@/app/api/properties/[slug]/route";
import { GET as chartRoute } from "@/app/api/properties/[slug]/chart/route";
import { api } from "@/lib/api-client/client";
import { toChartPoints, toChartSeries, toMarketSnapshot, toProperty } from "@/lib/api-client/adapter";
import { CATALOGUE, slugify } from "@/data/catalogue";
import { MOCK_PROPERTIES } from "@/data/properties";

/** Pin positions change with map art, so read them from the catalogue instead of hard-coding. */
const STARLET_MAP = CATALOGUE.find((e) => e.name === "Starlet Motel")!.map!;
import { addSnapshot, get, installMockProviders, makeLive, params, resetDatabase } from "../helpers/fixtures";

/** Runtime mirror of src/contracts/api.ts, used to prove responses match the published contract. */
const nullableNum = z.number().nullable();
const market = z
  .object({
    freshness: z.enum(["FRESH", "STALE", "UNAVAILABLE"]),
    reason: z.enum(["NOT_LAUNCHED", "TOKEN_INACTIVE", "NO_DATA_YET"]).nullable(),
    source: z.string().nullable(),
    priceUsd: nullableNum,
    priceSol: nullableNum,
    marketCapUsd: nullableNum,
    fdvUsd: nullableNum,
    volume24hUsd: nullableNum,
    change24hPct: nullableNum,
    liquidityUsd: nullableNum,
    lastTradeAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();
const token = z
  .object({
    id: z.string(),
    mintAddress: z.string().nullable(),
    name: z.string(),
    ticker: z.string(),
    imageUrl: z.string().nullable(),
    pumpFunUrl: z.string().nullable(),
    deploymentStatus: z.enum(["NOT_LAUNCHED", "PENDING_VERIFICATION", "LIVE", "INACTIVE"]),
    launchedAt: z.string().nullable(),
    creatorWallet: z.string().nullable(),
    isNative: z.boolean(),
    metadataStatus: z.enum(["UNVERIFIED", "VERIFIED", "MISMATCH"]),
    venue: z.enum(["UNKNOWN", "PUMPFUN_BONDING_CURVE", "PUMPSWAP", "OTHER_DEX"]),
    decimals: z.number().nullable(),
    supplyRaw: z.string().nullable(),
  })
  .strict();
const summary = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    category: z.string(),
    typeLabel: z.string().nullable(),
    region: z.string().nullable(),
    neighbourhood: z.string().nullable(),
    map: z.object({ x: z.number(), y: z.number() }).nullable(),
    imageUrl: z.string().nullable(),
    locationVerification: z.enum(["VERIFIED", "REPORTED", "CONCEPT"]),
    featured: z.boolean(),
    proposedTicker: z.string(),
    description: z.string(),
    launchOrder: z.number().int().positive().nullable(),
    token: token.nullable(),
    market,
  })
  .strict();
const detail = summary
  .extend({
    galleryImages: z.array(z.string()),
    sources: z.array(z.object({ url: z.string(), title: z.string(), note: z.string().nullable() }).strict()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

beforeEach(async () => {
  await resetDatabase();
  installMockProviders();
});

describe("frontend API contract", () => {
  it("list and detail responses match the published contract exactly", async () => {
    const live = await makeLive("starlet-motel");
    await addSnapshot(live.tokenId, 1000);
    const list = await (await listRoute(get("/api/properties?pageSize=50"))).json();
    z.object({ items: z.array(summary), page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }).strict().parse(list);
    detail.parse(await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json());
  });

  it("the typed client talks to the route handlers", async () => {
    const fetchImpl = (async (url: string) => {
      const u = new URL(url, "http://localhost:3530");
      if (u.pathname === "/api/properties") return listRoute(get(u.pathname + u.search));
      const slug = u.pathname.split("/")[3];
      return detailRoute(get(u.pathname), params({ slug }));
    }) as typeof fetch;
    const page = await api.listProperties({ category: "MARINA", sort: "name" }, { fetchImpl } as RequestInit);
    expect(page.items.map((i) => i.slug)).toContain("key-lento-marina-club");
    await expect(api.getProperty("missing", { fetchImpl } as RequestInit)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("adapter maps a not-launched listing to the UI view model without inventing numbers", async () => {
    const d = (await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json()) as PropertyDetailDto;
    const p = toProperty(d);
    expect(p).toMatchObject({
      slug: "starlet-motel",
      name: "Starlet Motel",
      category: "motel",
      region: "port-gellhorn",
      neighbourhood: "Port Gellhorn",
      featured: true,
      priority: 1,
      verification: { status: "unverified" },
      location: { x: STARLET_MAP[0], y: STARLET_MAP[1], precision: "approximate" },
      token: { ticker: "STARLET", status: "coming_soon", mint: null, mintVerified: false, pumpFunUrl: null },
      market: null,
    });
  });

  it("every seeded listing maps to the same view model as mock mode", async () => {
    const list = await (await listRoute(get("/api/properties?pageSize=50"))).json();
    const fromApi = new Map((list.items as PropertyDetailDto[]).map((d) => [d.slug, toProperty(d)]));
    expect(fromApi.size).toBe(CATALOGUE.length);
    for (const mock of MOCK_PROPERTIES) {
      const real = fromApi.get(mock.slug);
      expect(real, mock.slug).toBeDefined();
      const pick = (p: typeof mock) => ({
        name: p.name,
        category: p.category,
        region: p.region,
        neighbourhood: p.neighbourhood,
        description: p.description,
        featured: p.featured,
        priority: p.priority,
        location: p.location,
        ticker: p.token.ticker,
      });
      expect(pick(real!)).toEqual(pick(mock));
    }
    expect([...fromApi.keys()].sort()).toEqual(CATALOGUE.map((e) => slugify(e.name)).sort());
  });

  it("live tokens get verified mint links; fresh data is live and stale data is flagged", async () => {
    const live = await makeLive("starlet-motel");
    await addSnapshot(live.tokenId, 2000);
    let d = (await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json()) as PropertyDetailDto;
    let p = toProperty(d);
    expect(p.token).toMatchObject({ status: "live", mintVerified: true });
    expect(p.token.mint).toBe(d.token!.mintAddress);
    expect(p.market).toMatchObject({ source: "live", stale: false, holders: null });
    expect(p.market!.priceUsd).not.toBeNull();

    await resetDatabase();
    const again = await makeLive("starlet-motel");
    await addSnapshot(again.tokenId, 60 * 60_000);
    d = (await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json()) as PropertyDetailDto;
    p = toProperty(d);
    expect(p.market).toMatchObject({ source: "live", stale: true });
    expect(p.market!.priceUsd).not.toBeNull();
  });

  it("unavailable market data maps to null, never zero", () => {
    expect(
      toMarketSnapshot({
        freshness: "UNAVAILABLE", reason: "NO_DATA_YET", source: null, priceUsd: null, priceSol: null, marketCapUsd: null,
        fdvUsd: null, volume24hUsd: null, change24hPct: null, liquidityUsd: null, lastTradeAt: null, updatedAt: null,
      }),
    ).toBeNull();
  });

  it("chart adapter maps candles to close-price points, or an empty series when unavailable", async () => {
    const chart = await (await chartRoute(get("/api/properties/starlet-motel/chart"), params({ slug: "starlet-motel" }))).json();
    expect(toChartPoints(chart)).toEqual([]);
    expect(
      toChartPoints({ range: "24h", status: "OK", reason: null, interval: "15m", source: "x", fetchedAt: "", candles: [{ t: 10, open: 1, high: 2, low: 1, close: 1.5, volumeUsd: null }] }),
    ).toEqual([{ t: new Date(10_000).toISOString(), priceUsd: 1.5, volumeUsd: null }]);
  });

  it("chart series keeps why a chart is empty, and sorts candles oldest first", async () => {
    const chart = await (await chartRoute(get("/api/properties/starlet-motel/chart"), params({ slug: "starlet-motel" }))).json();
    expect(toChartSeries(chart)).toMatchObject({ points: [], unavailableReason: "not_launched", source: null });
    const ok = toChartSeries({
      range: "24h", status: "OK", reason: null, interval: "15m", source: "birdeye", fetchedAt: "2026-11-18T00:00:00.000Z",
      candles: [
        { t: 20, open: 2, high: 2, low: 2, close: 2, volumeUsd: 5 },
        { t: 10, open: 1, high: 1, low: 1, close: 1, volumeUsd: null },
      ],
    });
    expect(ok.unavailableReason).toBeNull();
    expect(ok.points.map((p) => p.priceUsd)).toEqual([1, 2]);
    expect(ok).toMatchObject({ interval: "15m", source: "birdeye" });
    expect(
      toChartSeries({ range: "7d", status: "UNAVAILABLE", reason: "RATE_LIMITED", interval: null, source: null, fetchedAt: "", candles: [] }),
    ).toMatchObject({ points: [], unavailableReason: "rate_limited" });
  });
});
