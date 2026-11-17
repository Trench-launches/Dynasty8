import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE, slugify } from "@/server/catalogue";
import { db, newKey, resetDatabase } from "../helpers/fixtures";

describe("migrations and seed", () => {
  beforeAll(resetDatabase);

  it("applied the migration (tables and custom constraints exist)", async () => {
    const tables = await db().$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const names = tables.map((t) => t.tablename);
    for (const t of ["Property", "Token", "MarketSnapshot", "AdminUser", "AuditLog", "SourceReference", "_prisma_migrations"]) {
      expect(names).toContain(t);
    }
    const checks = await db().$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE contype = 'c'`;
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining(["Token_native_has_no_property", "Token_mint_matches_status", "Property_map_xy_together"]),
    );
  });

  it("seeded exactly the 15 launch catalogue properties, each with a NOT_LAUNCHED token", async () => {
    const props = await db().property.findMany({ include: { token: true } });
    expect(props).toHaveLength(15);
    expect(new Set(props.map((p) => p.slug))).toEqual(new Set(CATALOGUE.map((c) => slugify(c.name))));
    for (const p of props) {
      expect(p.status).toBe("PUBLISHED");
      expect(p.locationVerification).toBe("CONCEPT");
      expect(p.mapX).toBeNull();
      expect(p.mapY).toBeNull();
      expect(p.token?.deploymentStatus).toBe("NOT_LAUNCHED");
      expect(p.token?.ticker).toBe(p.proposedTicker);
    }
    expect(props.filter((p) => p.catalogueGroup === "A")).toHaveLength(7);
  });

  it("contains no mint addresses, no pump links, no market data and no admins", async () => {
    expect(await db().token.count({ where: { mintAddress: { not: null } } })).toBe(0);
    expect(await db().token.count({ where: { pumpFunUrl: { not: null } } })).toBe(0);
    expect(await db().token.count({ where: { deploymentStatus: { not: "NOT_LAUNCHED" } } })).toBe(0);
    expect(await db().marketSnapshot.count()).toBe(0);
    expect(await db().adminUser.count()).toBe(0);
  });

  it("has exactly one native REALTY token, not tied to a property", async () => {
    const natives = await db().token.findMany({ where: { isNative: true } });
    expect(natives).toHaveLength(1);
    expect(natives[0]).toMatchObject({ ticker: "REALTY", propertyId: null, mintAddress: null, deploymentStatus: "NOT_LAUNCHED" });
  });

  it("is idempotent", async () => {
    const { seed } = await import("../../prisma/seed");
    const r = await seed(db());
    expect(r.created).toBe(0);
    expect(await db().property.count()).toBe(15);
  });

  it("enforces database-level invariants", async () => {
    await expect(db().token.create({ data: { name: "x", ticker: "X", isNative: true } })).rejects.toThrow(); // second native
    await expect(db().token.create({ data: { name: "x", ticker: "X", deploymentStatus: "LIVE" } })).rejects.toThrow(); // LIVE without mint
    await expect(db().token.create({ data: { name: "x", ticker: "X", mintAddress: newKey() } })).rejects.toThrow(); // NOT_LAUNCHED with mint
    const p = await db().property.findFirstOrThrow();
    await expect(db().property.update({ where: { id: p.id }, data: { mapX: 10 } })).rejects.toThrow(); // x without y
    const mint = newKey();
    await db().token.create({ data: { name: "a", ticker: "A", mintAddress: mint, deploymentStatus: "PENDING_VERIFICATION" } });
    await expect(db().token.create({ data: { name: "b", ticker: "A", mintAddress: mint, deploymentStatus: "PENDING_VERIFICATION" } })).rejects.toThrow(); // duplicate mint
  });
});
