import { beforeEach, describe, expect, it } from "vitest";
import type { ChartDto, EcosystemDto, HealthDto, Paginated, PropertyDetailDto, PropertySummaryDto } from "@/contracts/api";
import { GET as listRoute } from "@/app/api/properties/route";
import { GET as detailRoute } from "@/app/api/properties/[slug]/route";
import { GET as marketRoute } from "@/app/api/properties/[slug]/market/route";
import { GET as chartRoute } from "@/app/api/properties/[slug]/chart/route";
import { GET as ecosystemRoute } from "@/app/api/ecosystem/route";
import { GET as ecoMarketsRoute } from "@/app/api/ecosystem/markets/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { CATALOGUE, slugify } from "@/data/catalogue";
import { addSnapshot, db, get, installMockProviders, makeLive, params, resetDatabase } from "../helpers/fixtures";

async function list(qs = "") {
  const r = await listRoute(get(`/api/properties${qs}`));
  return { status: r.status, body: (await r.json()) as Paginated<PropertySummaryDto> & { error?: { code: string } } };
}

describe("GET /api/properties", () => {
  beforeEach(async () => {
    await resetDatabase();
    installMockProviders();
  });

  it("paginates published properties", async () => {
    const a = await list("?pageSize=10");
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ page: 1, pageSize: 10, total: 15, totalPages: 2 });
    expect(a.body.items).toHaveLength(10);
    const last = await list("?pageSize=10&page=2");
    expect(last.body.items).toHaveLength(5);
  });

  it("searches by name (case-insensitive) and by ticker with or without $", async () => {
    expect((await list("?q=marina")).body.items.map((i) => i.name).sort()).toEqual(["Key Lento Marina Club"]);
    expect((await list("?q=%24CROSSTOWN")).body.items.map((i) => i.slug)).toEqual(["cross-town-safehouse"]);
    expect((await list("?q=%24STARLET")).body.items.map((i) => i.slug)).toEqual(["starlet-motel"]);
    expect((await list("?q=mega")).body.items.map((i) => i.slug)).toEqual(["megamundo-hq"]);
  });

  it("filters by category, verification, featured and region", async () => {
    expect((await list("?category=GARAGE")).body.total).toBe(2);
    expect((await list("?category=MARINA")).body.total).toBe(1); // BOATWORKS left the launch 15
    expect((await list("?category=SAFEHOUSE")).body.items.map((i) => i.slug)).toContain("cross-town-safehouse");
    expect((await list("?verification=CONCEPT")).body.total).toBe(15);
    expect((await list("?verification=VERIFIED")).body.total).toBe(0);
    const featured = CATALOGUE.filter((e) => e.featured).map((e) => slugify(e.name));
    expect((await list("?featured=true")).body.items.map((i) => i.slug).sort()).toEqual(featured.sort());
    expect((await list("?region=port-gellhorn")).body.items.map((i) => i.slug).sort()).toEqual(["delights-cabaret", "starlet-motel"]);
    await db().property.update({ where: { slug: "pegassi-residences" }, data: { region: "Mount-Kalaga" } });
    expect((await list("?region=MOUNT-KALAGA")).body.items.map((i) => i.slug)).toEqual(["pegassi-residences"]);
  });

  it("hides drafts, unpublished and disabled listings", async () => {
    await db().property.update({ where: { slug: "starlet-motel" }, data: { status: "DISABLED" } });
    await db().property.update({ where: { slug: "paradise-garage" }, data: { status: "DRAFT" } });
    expect((await list()).body.total).toBe(13);
    const r = await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }));
    expect(r.status).toBe(404);
  });

  it("sorts by market cap, volume and 24h change with unavailable data last", async () => {
    const a = await makeLive("starlet-motel");
    const b = await makeLive("pegassi-residences");
    const c = await makeLive("ocean-view-hotel");
    await addSnapshot(a.tokenId, 1000, { marketCapUsd: 100, volume24hUsd: 900, change24hPct: -5 });
    await addSnapshot(b.tokenId, 1000, { marketCapUsd: 300, volume24hUsd: 100, change24hPct: 50 });
    await addSnapshot(c.tokenId, 1000, { marketCapUsd: null, volume24hUsd: 500, change24hPct: 1 });

    const mc = (await list("?sort=marketCap&pageSize=50")).body.items.map((i) => i.slug);
    expect(mc.slice(0, 2)).toEqual(["pegassi-residences", "starlet-motel"]);
    const mcAsc = (await list("?sort=marketCap&order=asc&pageSize=50")).body.items.map((i) => i.slug);
    expect(mcAsc.slice(0, 2)).toEqual(["starlet-motel", "pegassi-residences"]);
    expect(mcAsc.indexOf("ocean-view-hotel")).toBeGreaterThan(1); // null market cap sorts last
    expect((await list("?sort=volume")).body.items.slice(0, 3).map((i) => i.slug)).toEqual(["starlet-motel", "ocean-view-hotel", "pegassi-residences"]);
    expect((await list("?sort=change24h")).body.items.slice(0, 3).map((i) => i.slug)).toEqual(["pegassi-residences", "ocean-view-hotel", "starlet-motel"]);
  });

  it.each([
    ["?page=0", "page"],
    ["?pageSize=500", "pageSize"],
    ["?category=CASTLE", "category"],
    ["?sort=price", "sort"],
    ["?featured=yes", "featured"],
    ["?region=%3Cscript%3E", "region"],
    ["?q=" + "a".repeat(61), "q"],
  ])("rejects invalid query %s", async (qs, field) => {
    const r = await list(qs);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain(field);
  });

  it("rejects unsupported and duplicated parameters", async () => {
    expect((await list("?evil=1")).status).toBe(400);
    expect((await list("?page=1&page=2")).status).toBe(400);
  });

  it("rate limits abusive clients", async () => {
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await listRoute(get("/api/properties", { "x-forwarded-for": "203.0.113.9" }))).status;
    expect(last).toBe(429);
  });
});

describe("property detail, market and chart", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns detail for a not-launched property with no market numbers", async () => {
    const r = await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }));
    const body = (await r.json()) as PropertyDetailDto;
    expect(r.status).toBe(200);
    const [x, y] = CATALOGUE.find((e) => e.name === "Starlet Motel")!.map!;
    expect(body).toMatchObject({ slug: "starlet-motel", map: { x, y }, locationVerification: "CONCEPT", proposedTicker: "STARLET", sources: [] });
    expect(body.token).toMatchObject({ mintAddress: null, pumpFunUrl: null, deploymentStatus: "NOT_LAUNCHED" });
    expect(body.market).toMatchObject({ freshness: "UNAVAILABLE", reason: "NOT_LAUNCHED", priceUsd: null, marketCapUsd: null });
  });

  it("rejects malformed slugs and unknown properties", async () => {
    expect((await detailRoute(get("/api/properties/..%2F..%2Fetc"), params({ slug: "../../etc" }))).status).toBe(400);
    expect((await detailRoute(get("/api/properties/nope"), params({ slug: "nope" }))).status).toBe(404);
  });

  it("marks recent snapshots FRESH and old ones STALE, and flags missing data", async () => {
    const { tokenId } = await makeLive("starlet-motel");
    let m = await (await marketRoute(get("/api/properties/starlet-motel/market"), params({ slug: "starlet-motel" }))).json();
    expect(m.market).toMatchObject({ freshness: "UNAVAILABLE", reason: "NO_DATA_YET", priceUsd: null });

    await addSnapshot(tokenId, 10 * 60_000, { priceUsd: 0.001 });
    m = await (await marketRoute(get("/api/properties/starlet-motel/market"), params({ slug: "starlet-motel" }))).json();
    expect(m.market).toMatchObject({ freshness: "STALE", priceUsd: 0.001 });

    await addSnapshot(tokenId, 5_000, { priceUsd: 0.002, liquidityUsd: null });
    m = await (await marketRoute(get("/api/properties/starlet-motel/market"), params({ slug: "starlet-motel" }))).json();
    expect(m.market).toMatchObject({ freshness: "FRESH", priceUsd: 0.002, liquidityUsd: null, source: "mock-market" });
  });

  it("returns an explicit unavailable chart, never invented candles", async () => {
    const state = installMockProviders();
    const notLaunched = (await (await chartRoute(get("/api/properties/starlet-motel/chart?range=7d"), params({ slug: "starlet-motel" }))).json()) as ChartDto;
    expect(notLaunched).toMatchObject({ status: "UNAVAILABLE", reason: "NOT_LAUNCHED", candles: [] });

    const { tokenId } = await makeLive("starlet-motel");
    const noPool = (await (await chartRoute(get("/api/properties/starlet-motel/chart"), params({ slug: "starlet-motel" }))).json()) as ChartDto;
    expect(noPool).toMatchObject({ status: "UNAVAILABLE", reason: "NO_POOL", range: "24h" });

    await addSnapshot(tokenId, 1000);
    state.chart = async () => ({ interval: "1h", candles: [{ t: 1, open: 1, high: 2, low: 1, close: 2, volumeUsd: null }] });
    const ok = (await (await chartRoute(get("/api/properties/starlet-motel/chart?range=7d"), params({ slug: "starlet-motel" }))).json()) as ChartDto;
    expect(ok).toMatchObject({ status: "OK", range: "7d", interval: "1h", source: "mock-chart" });
    expect(ok.candles).toHaveLength(1);
  });

  it("reports rate limiting and provider failure as unavailable", async () => {
    const state = installMockProviders();
    const { tokenId } = await makeLive("starlet-motel");
    await addSnapshot(tokenId, 1000);
    const { ProviderError } = await import("@/server/http/fetch-json");
    state.chart = async () => {
      throw new ProviderError("429", "rate_limited");
    };
    const r1 = (await (await chartRoute(get("/api/properties/starlet-motel/chart?range=1h"), params({ slug: "starlet-motel" }))).json()) as ChartDto;
    expect(r1).toMatchObject({ status: "UNAVAILABLE", reason: "RATE_LIMITED", candles: [] });
    state.chart = async () => {
      throw new ProviderError("t", "timeout");
    };
    const r2 = (await (await chartRoute(get("/api/properties/starlet-motel/chart?range=30d"), params({ slug: "starlet-motel" }))).json()) as ChartDto;
    expect(r2).toMatchObject({ status: "UNAVAILABLE", reason: "PROVIDER_UNAVAILABLE" });
  });

  it("validates chart range", async () => {
    expect((await chartRoute(get("/api/properties/starlet-motel/chart?range=5y"), params({ slug: "starlet-motel" }))).status).toBe(400);
  });
});

describe("ecosystem and health", () => {
  beforeEach(resetDatabase);

  it("reports the DYNASTY placeholder and honest totals", async () => {
    const body = (await (await ecosystemRoute(get("/api/ecosystem"))).json()) as EcosystemDto;
    expect(body.nativeToken).toMatchObject({ ticker: "DYNASTY", isNative: true, deploymentStatus: "NOT_LAUNCHED", mintAddress: null });
    expect(body.nativeToken.market.freshness).toBe("UNAVAILABLE");
    expect(body.totals).toEqual({ listedProperties: 15, launchedPropertyTokens: 0, aggregateVolume24hUsd: null, aggregateMarketCapUsd: null, tokensWithFreshData: 0 });
    expect(body.disclaimer).toMatch(/does not own, control or back/);
  });

  it("aggregates only fresh data", async () => {
    const a = await makeLive("starlet-motel");
    const b = await makeLive("pegassi-residences");
    await addSnapshot(a.tokenId, 1000, { volume24hUsd: 100, marketCapUsd: 1000 });
    await addSnapshot(b.tokenId, 60 * 60_000, { volume24hUsd: 999, marketCapUsd: 999 }); // stale
    const body = (await (await ecosystemRoute(get("/api/ecosystem"))).json()) as EcosystemDto;
    expect(body.totals).toMatchObject({ launchedPropertyTokens: 2, aggregateVolume24hUsd: 100, aggregateMarketCapUsd: 1000, tokensWithFreshData: 1 });
    const rows = (await (await ecoMarketsRoute(get("/api/ecosystem/markets"))).json()).items;
    expect(rows).toHaveLength(2);
    expect(rows[0].property.slug).toBe("starlet-motel");
  });

  it("health is ok with no live tokens and reports providers", async () => {
    const r = await healthRoute(get("/api/health"));
    const body = (await r.json()) as HealthDto;
    expect(r.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", database: "ok", marketData: { stale: false } });
    expect(Object.keys(body.providers)).toEqual(expect.arrayContaining(["dexscreener", "geckoterminal", "birdeye", "helius"]));
  });

  it("health is degraded when live tokens have no recent data", async () => {
    await makeLive("starlet-motel");
    const body = (await (await healthRoute(get("/api/health"))).json()) as HealthDto;
    expect(body).toMatchObject({ status: "degraded", marketData: { stale: true } });
  });
});
