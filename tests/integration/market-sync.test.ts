import { beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "@/server/http/fetch-json";
import { pruneSnapshots, syncMarkets } from "@/server/services/market-sync";
import { db, installMockProviders, makeLive, quote, resetDatabase, type MockState } from "../helpers/fixtures";

let mocks: MockState;
beforeEach(async () => {
  await resetDatabase();
  mocks = installMockProviders();
});

describe("market data synchronisation", () => {
  it("does nothing (and calls no provider) when no token is live", async () => {
    mocks.marketError = new Error("should not be called");
    expect(await syncMarkets()).toMatchObject({ tokens: 0, snapshots: 0, error: null });
  });

  it("stores snapshots only for tokens the provider reported", async () => {
    const a = await makeLive("starlet-motel");
    const b = await makeLive("pegassi-residences");
    mocks.quotes.set(a.mint, quote({ priceUsd: 0.01, dexId: "pumpfun" }));
    const r = await syncMarkets();
    expect(r).toMatchObject({ tokens: 2, snapshots: 1, missing: [b.mint], provider: "mock-market" });
    expect(await db().marketSnapshot.count({ where: { tokenId: a.tokenId } })).toBe(1);
    expect(await db().marketSnapshot.count({ where: { tokenId: b.tokenId } })).toBe(0);
  });

  it("never writes data when the provider times out or is rate limited", async () => {
    await makeLive("starlet-motel");
    mocks.marketError = new ProviderError("timeout", "timeout");
    expect(await syncMarkets()).toMatchObject({ snapshots: 0, error: "timeout" });
    mocks.marketError = new ProviderError("429", "rate_limited");
    expect(await syncMarkets()).toMatchObject({ snapshots: 0, error: "rate_limited" });
    expect(await db().marketSnapshot.count()).toBe(0);
  });

  it("detects a venue change (bonding curve -> PumpSwap) and audits it", async () => {
    const a = await makeLive("starlet-motel");
    await db().token.update({ where: { id: a.tokenId }, data: { venue: "PUMPFUN_BONDING_CURVE" } });
    mocks.quotes.set(a.mint, quote({ dexId: "pumpswap" }));
    await syncMarkets();
    expect((await db().token.findUniqueOrThrow({ where: { id: a.tokenId } })).venue).toBe("PUMPSWAP");
    expect(await db().auditLog.count({ where: { action: "token.venue_changed", actorLabel: "system:market-sync" } })).toBe(1);
  });

  it("includes the native token once it is live", async () => {
    const native = await db().token.findFirstOrThrow({ where: { isNative: true } });
    const mint = (await import("../helpers/fixtures")).newKey();
    await db().token.update({ where: { id: native.id }, data: { mintAddress: mint, deploymentStatus: "LIVE" } });
    mocks.quotes.set(mint, quote());
    expect((await syncMarkets()).snapshots).toBe(1);
  });

  it("prunes old snapshots", async () => {
    const a = await makeLive("starlet-motel");
    await db().marketSnapshot.create({ data: { tokenId: a.tokenId, source: "x", fetchedAt: new Date(Date.now() - 40 * 86_400_000) } });
    expect(await pruneSnapshots(30)).toBe(1);
  });
});
