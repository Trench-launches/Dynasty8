import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLaunchConfigs, DEV_BUY_LAMPORTS, renderLaunchConfigs, validateCatalogue, validateLaunchConfig } from "../../scripts/launch-config";
import { vaultAddress } from "@/server/demolition/squads";
import { CATALOGUE, RESERVE_CANDIDATES } from "@/data/catalogue";

const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8"));
const FUND = "3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV";

describe("treasury config (owner-confirmed 2026-11-18)", () => {
  it("lists vaults 0/1/2 of the Dynasty multisig at 6000/2500/1500", () => {
    expect(treasury.multisig).toBe("BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn");
    expect(treasury.wallets.map((w: { role: string; shareBps: number }) => [w.role, w.shareBps])).toEqual([
      ["FUND", 6000],
      ["ECOSYSTEM", 2500],
      ["OPERATIONS", 1500],
    ]);
    for (const w of treasury.wallets) expect(w.address).toBe(vaultAddress(treasury.multisig, w.vaultIndex));
    expect(treasury.wallets[0].address).toBe(FUND);
  });
});

describe("launch catalogue: CROSSTOWN replaces BOATWORKS", () => {
  it("has exactly 15 unique property coins, with CROSSTOWN and without BOATWORKS", () => {
    expect(CATALOGUE).toHaveLength(15);
    expect(new Set(CATALOGUE.map((e) => e.ticker)).size).toBe(15);
    expect(CATALOGUE.map((e) => e.ticker)).toContain("CROSSTOWN");
    expect(CATALOGUE.map((e) => e.ticker)).not.toContain("BOATWORKS");
  });

  it("keeps BOATWORKS' data in the reserve list and invents nothing for CROSSTOWN", () => {
    expect(RESERVE_CANDIDATES.find((e) => e.ticker === "BOATWORKS")).toMatchObject({ name: "Brian's Boat Works & Marina", map: [608, 1134] });
    expect(RESERVE_CANDIDATES.find((e) => e.ticker === "CROSSTOWN")).toBeUndefined();
    const crosstown = CATALOGUE.find((e) => e.ticker === "CROSSTOWN")!;
    expect(crosstown).toEqual({ group: "A", name: "Cross Town Safehouse", ticker: "CROSSTOWN", typeLabel: "Safehouse", category: "SAFEHOUSE" });
  });
});

describe("Pump launch configs", () => {
  const { dynasty, properties } = buildLaunchConfigs(treasury);

  it("$DYNASTY routes 100% to the FUND vault (Option C), not the property split", () => {
    expect(dynasty.feeSharing).toMatchObject({ policy: "DYNASTY_FUND_100", shareholders: [{ role: "FUND", address: FUND, shareBps: 10_000 }], lockAfterSetup: true });
    expect(dynasty.status).toBe("READY_FOR_OWNER_REVIEW");
    expect(validateLaunchConfig(dynasty)).toEqual([]);
  });

  it("every property coin uses FUND 6000 / ECOSYSTEM 2500 / OPERATIONS 1500", () => {
    for (const c of properties) {
      expect(c.feeSharing.policy).toBe("PROPERTY_60_25_15");
      expect(c.feeSharing.shareholders.map((h) => [h.address, h.shareBps])).toEqual(treasury.wallets.map((w: { address: string; shareBps: number }) => [w.address, w.shareBps]));
    }
    expect(validateCatalogue(properties)).toEqual([]);
  });

  it("every launch includes the 0.01 SOL dev buy", () => {
    expect(DEV_BUY_LAMPORTS).toBe("10000000");
    for (const c of [dynasty, ...properties]) expect(c.devBuyLamports).toBe("10000000");
  });

  it("holds CROSSTOWN back until the owner approves its artwork, description and map placement", () => {
    const c = properties.find((p) => p.symbol === "CROSSTOWN")!;
    expect(c).toMatchObject({ status: "PENDING_DECISION", launchImage: null, launchImageSha256: null, image: null });
    expect(c.pending.join(" ")).toMatch(/artwork.*description.*map placement/s);
    expect(c.description).toMatch(/^Cross Town Safehouse is a proposed safehouse listing/);
    expect(properties.filter((p) => p.status === "READY_FOR_OWNER_REVIEW")).toHaveLength(14);
  });

  it("rejects configurations that break Pump's rules or an owner decision", () => {
    const wrongNative = { ...dynasty, feeSharing: { ...dynasty.feeSharing, shareholders: properties[0]!.feeSharing.shareholders } };
    expect(validateLaunchConfig(wrongNative).join(" ")).toMatch(/100% to the FUND vault/);
    const wrongVault = { ...properties[0]!, feeSharing: { ...properties[0]!.feeSharing, shareholders: [{ role: "FUND", address: FUND, shareBps: 10_000 }] } };
    expect(validateLaunchConfig(wrongVault).join(" ")).toMatch(/6000 \/ ECOSYSTEM 2500/);
    expect(validateLaunchConfig({ ...dynasty, devBuyLamports: "20000000" }).join(" ")).toMatch(/0.01 SOL/);
    expect(validateLaunchConfig({ ...dynasty, symbol: "TOOLONGSYMBOL" }).join(" ")).toMatch(/symbol/);
    expect(validateLaunchConfig({ ...properties[0]!, launchImage: null }).join(" ")).toMatch(/launch image/);
    expect(validateCatalogue(properties.slice(1))).toEqual(["expected 15 property coins, found 14"]);
    expect(validateCatalogue([...properties.slice(1), properties[1]!]).join(" ")).toMatch(/duplicate/);
  });

  it("has a square launch image with a recorded hash and an upload-ready metadata template for every ready coin", () => {
    const dims = (path: string) => {
      const b = readFileSync(path);
      if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
      for (let i = 2; i < b.length; ) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const m = b[i + 1]!;
        if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    };
    for (const c of [dynasty, ...properties].filter((x) => x.status === "READY_FOR_OWNER_REVIEW")) {
      expect(dims(c.launchImage!), c.launchImage!).toEqual([1000, 1000]);
      expect(c.launchImageSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(c.metadata).toMatchObject({ name: c.name, symbol: c.symbol, description: c.description, website: c.website, showName: true });
      if (c.kind === "PROPERTY") expect(c.description).toMatch(/Not affiliated with or endorsed by Rockstar Games/);
    }
  });

  it("committed JSON, metadata templates and launch cards match the generator", () => {
    for (const [path, body] of Object.entries(renderLaunchConfigs(treasury))) {
      expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n"), path).toBe(body);
    }
  });
});
