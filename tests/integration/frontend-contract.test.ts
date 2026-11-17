import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { PropertyDetailDto } from "@/contracts/api";
import { GET as listRoute } from "@/app/api/properties/route";
import { GET as detailRoute } from "@/app/api/properties/[slug]/route";
import { GET as chartRoute } from "@/app/api/properties/[slug]/chart/route";
import { api } from "@/lib/api-client/client";
import { hasMapPosition, toMarketView, toPricePoints, toTokenIdentity } from "@/lib/api-client/adapter";
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
    token: token.nullable(),
    market,
  })
  .strict();
const detail = summary
  .extend({
    description: z.string(),
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

  it("adapter never turns unavailable data into numbers", async () => {
    const d = (await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json()) as PropertyDetailDto;
    const view = toMarketView(d.proposedTicker, d.market);
    expect(view).toMatchObject({ data: null, freshness: "UNAVAILABLE", label: "Token not launched" });
    expect(hasMapPosition(d)).toBe(false);
    expect(toTokenIdentity(d.token!)).toMatchObject({ ticker: "STARLET", mintAddress: null, pumpFunUrl: null });
  });

  it("adapter labels fresh data live and stale data as stale", async () => {
    const live = await makeLive("starlet-motel");
    await addSnapshot(live.tokenId, 2000);
    let d = (await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json()) as PropertyDetailDto;
    expect(toMarketView("STARLET", d.market).data?.source).toBe("live");

    await resetDatabase();
    const again = await makeLive("starlet-motel");
    await addSnapshot(again.tokenId, 60 * 60_000);
    d = (await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json()) as PropertyDetailDto;
    const v = toMarketView("STARLET", d.market);
    expect(v.isStale).toBe(true);
    expect(v.data).toBeNull();
    expect(v.raw.priceUsd).not.toBeNull();
    expect(v.label).toMatch(/^Last updated/);
  });

  it("chart adapter maps candles to the existing PricePoint format, or null when unavailable", async () => {
    const chart = await (await chartRoute(get("/api/properties/starlet-motel/chart"), params({ slug: "starlet-motel" }))).json();
    expect(toPricePoints(chart)).toBeNull();
    expect(toPricePoints({ range: "24h", status: "OK", reason: null, interval: "15m", source: "x", fetchedAt: "", candles: [{ t: 10, open: 1, high: 2, low: 1, close: 1.5, volumeUsd: null }] })).toEqual([{ t: 10_000, price: 1.5 }]);
  });
});
