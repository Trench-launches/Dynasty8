import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as adminList, POST as createRoute } from "@/app/api/admin/properties/route";
import { PATCH as patchRoute } from "@/app/api/admin/properties/[slug]/route";
import { POST as attachRoute } from "@/app/api/admin/properties/[slug]/token/route";
import { POST as verifyRoute } from "@/app/api/admin/tokens/[id]/verify/route";
import { PATCH as tokenStatusRoute } from "@/app/api/admin/tokens/[id]/route";
import { POST as nativeRoute } from "@/app/api/admin/ecosystem/token/route";
import { GET as auditRoute } from "@/app/api/admin/audit/route";
import { GET as detailRoute } from "@/app/api/properties/[slug]/route";
import { setSessionResolverForTests } from "@/server/auth/admin";
import { db, get, installMockProviders, newKey, params, resetDatabase, send, signInAs, validMint, type MockState } from "../helpers/fixtures";

const newProperty = {
  slug: "test-penthouse",
  name: "Test Penthouse",
  description: "A listing created in a test.",
  category: "LUXURY",
  proposedTicker: "TPENT",
};

let mocks: MockState;
beforeEach(async () => {
  await resetDatabase();
  mocks = installMockProviders();
});
afterEach(() => setSessionResolverForTests(null));

describe("admin authentication and authorisation", () => {
  it("rejects anonymous requests with 401", async () => {
    await signInAs(null);
    expect((await adminList(get("/api/admin/properties"))).status).toBe(401);
    expect((await createRoute(send("POST", "/api/admin/properties", newProperty))).status).toBe(401);
  });

  it("rejects signed-in users who are not active admins", async () => {
    setSessionResolverForTests(async () => "999999");
    expect((await adminList(get("/api/admin/properties"))).status).toBe(403);
    await signInAs("ADMIN", { active: false });
    expect((await adminList(get("/api/admin/properties"))).status).toBe(403);
  });

  it("enforces roles: VIEWER reads, EDITOR edits content, ADMIN controls tokens and verification", async () => {
    await signInAs("VIEWER");
    expect((await adminList(get("/api/admin/properties"))).status).toBe(200);
    expect((await createRoute(send("POST", "/api/admin/properties", newProperty))).status).toBe(403);

    await signInAs("EDITOR");
    expect((await createRoute(send("POST", "/api/admin/properties", newProperty))).status).toBe(201);
    expect((await patchRoute(send("PATCH", "/api/admin/properties/test-penthouse", { featured: true }), params({ slug: "test-penthouse" }))).status).toBe(200);
    expect((await patchRoute(send("PATCH", "/api/admin/properties/test-penthouse", { status: "DISABLED" }), params({ slug: "test-penthouse" }))).status).toBe(403);
    expect((await attachRoute(send("POST", "/api/admin/properties/test-penthouse/token", { mintAddress: newKey() }), params({ slug: "test-penthouse" }))).status).toBe(403);
  });

  it("blocks cross-site and origin-less mutations (CSRF)", async () => {
    await signInAs("ADMIN");
    const evil = await createRoute(send("POST", "/api/admin/properties", newProperty, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    const req = new Request("http://localhost:3530/api/admin/properties", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newProperty) });
    expect((await createRoute(req)).status).toBe(403);
  });
});

describe("property management", () => {
  beforeEach(async () => {
    await signInAs("ADMIN");
  });

  it("creates a property with a NOT_LAUNCHED token and audits it", async () => {
    const r = await createRoute(send("POST", "/api/admin/properties", { ...newProperty, status: "PUBLISHED" }));
    const body = await r.json();
    expect(r.status).toBe(201);
    expect(body.token).toMatchObject({ ticker: "TPENT", deploymentStatus: "NOT_LAUNCHED", mintAddress: null });
    const log = await db().auditLog.findFirst({ where: { action: "property.create", entityId: body.id } });
    expect(log?.actorLabel).toMatch(/^github:/);
    expect((await detailRoute(get("/api/properties/test-penthouse"), params({ slug: "test-penthouse" }))).status).toBe(200);
  });

  it("validates input strictly", async () => {
    const bad = [
      { ...newProperty, slug: "Bad Slug!" },
      { ...newProperty, proposedTicker: "lower" },
      { ...newProperty, imageUrl: "javascript:alert(1)" },
      { ...newProperty, imageUrl: "http://insecure.example/a.png" },
      { ...newProperty, mapX: 10 },
      { ...newProperty, locationVerification: "VERIFIED" },
      { ...newProperty, unexpected: true },
      { ...newProperty, name: "x" + String.fromCharCode(0x202e) + "evil" },
    ];
    for (const b of bad) expect((await createRoute(send("POST", "/api/admin/properties", b))).status).toBe(400);
    const notJson = new Request("http://localhost:3530/api/admin/properties", { method: "POST", headers: { "content-type": "text/plain", origin: "http://localhost:3530" }, body: "hi" });
    expect((await createRoute(notJson)).status).toBe(415);
  });

  it("rejects duplicate slugs with 409", async () => {
    await createRoute(send("POST", "/api/admin/properties", newProperty));
    expect((await createRoute(send("POST", "/api/admin/properties", newProperty))).status).toBe(409);
  });

  it("updates descriptions, images, verification (with sources) and publish state", async () => {
    const slug = "pegassi-residences";
    const ok = await patchRoute(
      send("PATCH", `/api/admin/properties/${slug}`, {
        description: "Updated copy.",
        imageUrl: "https://cdn.example.com/vercetti.png",
        locationVerification: "REPORTED",
        sources: [{ url: "https://example.com/report", title: "Community report" }],
        mapX: 120,
        mapY: 340,
      }),
      params({ slug }),
    );
    expect(ok.status).toBe(200);
    const detail = await (await detailRoute(get(`/api/properties/${slug}`), params({ slug }))).json();
    expect(detail).toMatchObject({ description: "Updated copy.", locationVerification: "REPORTED", map: { x: 120, y: 340 }, sources: [{ title: "Community report" }] });

    const noSource = await patchRoute(send("PATCH", "/api/admin/properties/starlet-motel", { locationVerification: "VERIFIED" }), params({ slug: "starlet-motel" }));
    expect(noSource.status).toBe(422);

    await patchRoute(send("PATCH", `/api/admin/properties/${slug}`, { status: "UNPUBLISHED" }), params({ slug }));
    expect((await detailRoute(get(`/api/properties/${slug}`), params({ slug }))).status).toBe(404);
    const audit = await db().auditLog.findMany({ where: { action: "property.update" } });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[0].before).toBeTruthy();
    expect(audit[0].after).toBeTruthy();
  });
});

describe("token registration (read-only Solana verification)", () => {
  beforeEach(async () => {
    await signInAs("ADMIN");
  });
  const attach = (slug: string, body: unknown) => attachRoute(send("POST", `/api/admin/properties/${slug}/token`, body), params({ slug }));

  it("rejects invalid Solana addresses", async () => {
    for (const mintAddress of ["", "not-a-key", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", "1".repeat(60)]) {
      expect((await attach("starlet-motel", { mintAddress })).status).toBe(400);
    }
  });

  it("rejects mints that do not exist on-chain or are not SPL mints", async () => {
    expect((await attach("starlet-motel", { mintAddress: newKey() })).status).toBe(422);
    const notMint = newKey();
    mocks.mints.set(notMint, { exists: true, program: null, supply: null, decimals: null, mintAuthority: null, freezeAuthority: null });
    expect((await attach("starlet-motel", { mintAddress: notMint })).status).toBe(422);
  });

  it("registers a real mint as PENDING_VERIFICATION, with a Pump.fun link only when a curve exists", async () => {
    const mint = newKey();
    mocks.mints.set(mint, validMint());
    mocks.metadata.set(mint, { name: "Starlet Motel", symbol: "STARLET" });
    const r = await attach("starlet-motel", { mintAddress: mint });
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.token).toMatchObject({ mintAddress: mint, deploymentStatus: "PENDING_VERIFICATION", pumpFunUrl: null, venue: "UNKNOWN", decimals: 6 });
    expect(body.checks).toMatchObject({ mintExists: true, pumpBondingCurve: false, metadataSymbolMatchesTicker: true });

    // Not shown publicly until verified.
    const pub = await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json();
    expect(pub.market.reason).toBe("NOT_LAUNCHED");

    const pumpMint = newKey();
    mocks.mints.set(pumpMint, validMint());
    mocks.curves.set(pumpMint, { exists: true, complete: false });
    const p = await (await attach("paradise-garage", { mintAddress: pumpMint })).json();
    expect(p.token).toMatchObject({ venue: "PUMPFUN_BONDING_CURVE", pumpFunUrl: `https://pump.fun/coin/${pumpMint}` });
  });

  it("rejects duplicate registrations of the same mint", async () => {
    const mint = newKey();
    mocks.mints.set(mint, validMint());
    expect((await attach("starlet-motel", { mintAddress: mint })).status).toBe(200);
    expect((await attach("paradise-garage", { mintAddress: mint })).status).toBe(409);
    expect((await attach("starlet-motel", { mintAddress: newKey() })).status).toBe(409); // already has a mint
  });

  it("requires acknowledgement to verify a token whose metadata does not match", async () => {
    const mint = newKey();
    mocks.mints.set(mint, validMint());
    mocks.metadata.set(mint, { name: "Totally Different", symbol: "SCAM" });
    const attached = await (await attach("starlet-motel", { mintAddress: mint })).json();
    expect(attached.token.metadataStatus).toBe("MISMATCH");
    const id = attached.token.id as string;

    const refused = await verifyRoute(send("POST", `/api/admin/tokens/${id}/verify`, {}), params({ id }));
    expect(refused.status).toBe(422);
    const ok = await verifyRoute(send("POST", `/api/admin/tokens/${id}/verify`, { acknowledgeMetadataMismatch: true, note: "Creator renamed symbol; confirmed with team." }), params({ id }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).deploymentStatus).toBe("LIVE");
  });

  it("verifies, then deactivates a compromised token and disables its listing", async () => {
    const mint = newKey();
    mocks.mints.set(mint, validMint());
    const id = (await (await attach("starlet-motel", { mintAddress: mint })).json()).token.id as string;
    const v = await (await verifyRoute(send("POST", `/api/admin/tokens/${id}/verify`, { launchedAt: "2026-11-01T00:00:00.000Z" }), params({ id }))).json();
    expect(v).toMatchObject({ deploymentStatus: "LIVE", metadataStatus: "VERIFIED" });

    const pub = await (await detailRoute(get("/api/properties/starlet-motel"), params({ slug: "starlet-motel" }))).json();
    expect(pub.token).toMatchObject({ mintAddress: mint, deploymentStatus: "LIVE" });
    expect(pub.market).toMatchObject({ freshness: "UNAVAILABLE", reason: "NO_DATA_YET" });

    const off = await tokenStatusRoute(send("PATCH", `/api/admin/tokens/${id}`, { deploymentStatus: "INACTIVE", reason: "Mint authority compromised" }), params({ id }));
    expect((await off.json()).deploymentStatus).toBe("INACTIVE");

    await tokenStatusRoute(send("PATCH", `/api/admin/tokens/${id}`, { deploymentStatus: "LIVE", reason: "Resolved" }), params({ id }));
    await patchRoute(send("PATCH", "/api/admin/properties/starlet-motel", { status: "DISABLED" }), params({ slug: "starlet-motel" }));
    const t = await db().token.findUniqueOrThrow({ where: { id } });
    expect(t.deploymentStatus).toBe("INACTIVE");

    const audit = await (await auditRoute(get(`/api/admin/audit?entityType=Token&entityId=${id}`))).json();
    expect(audit.items.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(["token.attach_mint", "token.verify", "token.deactivate", "token.reactivate", "token.deactivated_with_property"]),
    );
  });

  it("attaches the native REALTY mint separately from property tokens", async () => {
    const mint = newKey();
    mocks.mints.set(mint, validMint());
    const r = await nativeRoute(send("POST", "/api/admin/ecosystem/token", { mintAddress: mint }));
    expect((await r.json()).token).toMatchObject({ isNative: true, propertyId: null, deploymentStatus: "PENDING_VERIFICATION" });
  });

  it("returns 503 (not a fake success) when the RPC is unreachable", async () => {
    const { ProviderError } = await import("@/server/http/fetch-json");
    const { setProvidersForTests, getProviders } = await import("@/server/providers/registry");
    const p = getProviders();
    setProvidersForTests({ ...p, solana: { ...p.solana, getMintInfo: async () => { throw new ProviderError("t", "timeout"); } } });
    expect((await attach("starlet-motel", { mintAddress: newKey() })).status).toBe(503);
    expect(await db().token.count({ where: { mintAddress: { not: null } } })).toBe(0);
  });
});
