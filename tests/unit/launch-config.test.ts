import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLaunchConfigs, renderLaunchConfigs, validateLaunchConfig } from "../../scripts/launch-config";
import { vaultAddress } from "@/server/demolition/squads";
import { CATALOGUE } from "@/data/catalogue";

const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8"));

describe("treasury config (owner-confirmed 2026-11-18)", () => {
  it("lists vaults 0/1/2 of the Dynasty multisig at 6000/2500/1500", () => {
    expect(treasury.multisig).toBe("BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn");
    expect(treasury.wallets.map((w: { role: string; shareBps: number }) => [w.role, w.shareBps])).toEqual([
      ["FUND", 6000],
      ["ECOSYSTEM", 2500],
      ["OPERATIONS", 1500],
    ]);
    for (const w of treasury.wallets) expect(w.address).toBe(vaultAddress(treasury.multisig, w.vaultIndex));
    expect(treasury.wallets.map((w: { address: string }) => w.address)).toEqual([
      "3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV",
      "FF5mJunnU3Wx216iwnqtaBaANJsUajSvYoMVZ9XoKokH",
      "A5optT3YTSHpxvTD4xiD5brxvSG9cKxjCcesZjRSRQPR",
    ]);
  });
});

describe("Pump launch configs", () => {
  const { dynasty, properties } = buildLaunchConfigs(treasury);

  it("covers DYNASTY and exactly the 15 catalogue properties, all valid for Pump", () => {
    expect(properties.map((p) => p.symbol)).toEqual(CATALOGUE.map((e) => e.ticker));
    for (const c of [dynasty, ...properties]) expect(validateLaunchConfig(c)).toEqual([]);
  });

  it("routes every coin's creator fees to the three treasury vaults and locks the split", () => {
    for (const c of [dynasty, ...properties]) {
      expect(c.feeSharing.shareholders.map((h) => [h.address, h.shareBps])).toEqual(treasury.wallets.map((w: { address: string; shareBps: number }) => [w.address, w.shareBps]));
      expect(c.feeSharing.lockAfterSetup).toBe(true);
      expect(c.creatorWallet).toBeNull(); // the owner fills in the launch wallet
    }
  });

  it("holds back BOATWORKS until the catalogue decision and flags DYNASTY's fee decision", () => {
    expect(properties.find((p) => p.symbol === "BOATWORKS")).toMatchObject({ status: "PENDING_DECISION" });
    expect(dynasty.status).toBe("PENDING_DECISION");
    expect(dynasty.pending.join(" ")).toMatch(/D-NATIVE-FEES/);
  });

  it("catches launch configs Pump would reject", () => {
    const bad = { ...dynasty, symbol: "TOOLONGSYMBOL", feeSharing: { ...dynasty.feeSharing, shareholders: [{ role: "FUND", address: "x", shareBps: 9_999 }] } };
    expect(validateLaunchConfig(bad)).toEqual(expect.arrayContaining([expect.stringMatching(/symbol/), expect.stringMatching(/sum to 10000/)]));
  });

  it("committed JSON matches the generator", () => {
    for (const [path, body] of Object.entries(renderLaunchConfigs(treasury))) {
      expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n")).toBe(body);
    }
  });
});
