import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { setSessionResolverForTests } from "@/server/auth/admin";
import {
  CREATE_FEE_SHARING_CONFIG,
  decodeBondingCurve,
  prepareFeeSharingSetup,
  setPumpSetupRpcForTests,
  SWEEP_CREATOR_FEE,
  UPDATE_FEE_SHARES_V2,
  type PumpSetupRpc,
} from "@/server/demolition/fee-sharing-setup";
import { PUMP_PROGRAMS, sharingConfigAddress, SHARING_CONFIG_DISCRIMINATOR } from "@/server/demolition/pump-fees";
import { POST as setupRoute } from "@/app/api/admin/demolition-fund/fee-sharing/setup/route";
import { db, installMockProviders, makeLive, newKey, resetDatabase, send, signInAs } from "../helpers/fixtures";
import { installDemolitionDeps, setupFund } from "../helpers/demolition";

const ADMIN = { id: "admin-1", label: "test-admin" };
const PUMP = new PublicKey(PUMP_PROGRAMS.pump);
const WSOL = "So11111111111111111111111111111111111111112";

/** BondingCurve bytes in the current layout (see decodeBondingCurve). */
function curve(p: { creator: string; complete?: boolean; quoteMint?: string; holderReward?: boolean; pendingFee?: bigint }) {
  const b = Buffer.alloc(150);
  b[48] = p.complete ? 1 : 0;
  new PublicKey(p.creator).toBuffer().copy(b, 49);
  new PublicKey(p.quoteMint ?? WSOL).toBuffer().copy(b, 83);
  b[124] = p.holderReward ? 1 : 0;
  b.writeBigUInt64LE(p.pendingFee ?? 0n, 125);
  return b;
}

function sharing(p: { mint: string; admin: string; revoked: boolean; holders: { address: string; shareBps: number }[] }) {
  const n = Buffer.alloc(4);
  n.writeUInt32LE(p.holders.length);
  return Buffer.concat([
    SHARING_CONFIG_DISCRIMINATOR,
    Buffer.from([255, 2, 1]),
    new PublicKey(p.mint).toBuffer(),
    new PublicKey(p.admin).toBuffer(),
    Buffer.from([p.revoked ? 1 : 0]),
    n,
    ...p.holders.flatMap((h) => {
      const s = Buffer.alloc(2);
      s.writeUInt16LE(h.shareBps);
      return [new PublicKey(h.address).toBuffer(), s];
    }),
  ]);
}

class FakeRpc implements PumpSetupRpc {
  accounts = new Map<string, { owner: string; data: Buffer }>();
  simErr: unknown = null;
  simulated: VersionedTransaction[] = [];
  outage = false;
  async getAccount(a: string) {
    if (this.outage) throw new Error("rpc down");
    return this.accounts.get(a) ?? null;
  }
  async getLatestBlockhash() {
    return PublicKey.default.toBase58();
  }
  async getBalance() {
    return 1_000_000_000;
  }
  async getSlot() {
    return 1000;
  }
  async getLookupTable() {
    return null;
  }
  async simulate(tx: VersionedTransaction) {
    this.simulated.push(tx);
    return { err: this.simErr, logs: this.simErr ? ["Program log: AnchorError ... Error Code: X", "failed"] : ["success"] };
  }
}

let rpc: FakeRpc;
let starlet: { tokenId: string; mint: string };
let f: Awaited<ReturnType<typeof setupFund>>;
const creator = newKey();
const bondingCurve = (mint: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP)[0].toBase58();

beforeEach(async () => {
  await resetDatabase();
  installMockProviders();
  installDemolitionDeps();
  starlet = await makeLive("starlet-motel");
  f = await setupFund({ mode: "ON_CHAIN_SPLIT" });
  rpc = new FakeRpc();
  setPumpSetupRpcForTests(rpc);
  rpc.accounts.set(bondingCurve(starlet.mint), { owner: PUMP_PROGRAMS.pump, data: curve({ creator }) });
});

afterEach(() => {
  setPumpSetupRpcForTests(null);
  setSessionResolverForTests(null);
});

const expected = () => [
  { address: f.fund, shareBps: 6000 },
  { address: f.ecosystem, shareBps: 2500 },
  { address: f.operations, shareBps: 1500 },
];

function decodeShares(data: Uint8Array) {
  const b = Buffer.from(data);
  const n = b.readUInt32LE(8);
  return Array.from({ length: n }, (_, i) => ({ address: new PublicKey(b.subarray(12 + i * 34, 44 + i * 34)).toBase58(), shareBps: b.readUInt16LE(44 + i * 34) }));
}

describe("post-launch fee-sharing setup", () => {
  it("builds create + update with the REGISTERED treasury vaults, signed only by the creator", async () => {
    const s = await prepareFeeSharingSetup(starlet.mint, creator, ADMIN);
    expect(s.steps).toEqual(["create_fee_sharing_config", "update_fee_shares_v2"]);
    expect(s.shareholders).toEqual(expected());
    const tx = VersionedTransaction.deserialize(Buffer.from(s.transactionBase64, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys[0]).toBe(creator);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    const ixs = tx.message.compiledInstructions.filter((ix) => keys[ix.programIdIndex] === PUMP_PROGRAMS.fees);
    expect(Buffer.from(ixs[0]!.data)).toEqual(CREATE_FEE_SHARING_CONFIG);
    expect(Buffer.from(ixs[1]!.data.subarray(0, 8))).toEqual(UPDATE_FEE_SHARES_V2);
    expect(decodeShares(ixs[1]!.data)).toEqual(expected());
    expect(keys).toContain(sharingConfigAddress(starlet.mint));
    expect(rpc.simulated).toHaveLength(1);
    expect(await db().auditLog.count({ where: { action: "fee_sharing.setup_prepared" } })).toBe(1);
  });

  it("sweeps a waiting creator fee first, so Pump allows the creator change", async () => {
    rpc.accounts.set(bondingCurve(starlet.mint), { owner: PUMP_PROGRAMS.pump, data: curve({ creator, pendingFee: 12_345n }) });
    const s = await prepareFeeSharingSetup(starlet.mint, creator, ADMIN);
    expect(s.steps).toEqual(["sweep_creator_fee", "create_fee_sharing_config", "update_fee_shares_v2"]);
    const tx = VersionedTransaction.deserialize(Buffer.from(s.transactionBase64, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const pumpIx = tx.message.compiledInstructions.find((ix) => keys[ix.programIdIndex] === PUMP_PROGRAMS.pump)!;
    expect(Buffer.from(pumpIx.data)).toEqual(SWEEP_CREATOR_FEE);
  });

  it("only updates the shares when the creator already created an unlocked config", async () => {
    rpc.accounts.set(sharingConfigAddress(starlet.mint), { owner: PUMP_PROGRAMS.fees, data: sharing({ mint: starlet.mint, admin: creator, revoked: false, holders: [{ address: creator, shareBps: 10_000 }] }) });
    expect((await prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).steps).toEqual(["update_fee_shares_v2"]);
  });

  it("refuses unregistered mints, other wallets, locked configs, graduated or unsupported coins", async () => {
    await expect(prepareFeeSharingSetup(newKey(), creator, ADMIN)).rejects.toThrow(/Register this mint/);
    await expect(prepareFeeSharingSetup(starlet.mint, newKey(), ADMIN)).rejects.toMatchObject({ status: 403 });

    rpc.accounts.set(sharingConfigAddress(starlet.mint), { owner: PUMP_PROGRAMS.fees, data: sharing({ mint: starlet.mint, admin: creator, revoked: true, holders: expected() }) });
    await expect(prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).rejects.toThrow(/already locked/);
    rpc.accounts.delete(sharingConfigAddress(starlet.mint));

    for (const c of [{ complete: true }, { holderReward: true }, { quoteMint: newKey() }]) {
      rpc.accounts.set(bondingCurve(starlet.mint), { owner: PUMP_PROGRAMS.pump, data: curve({ creator, ...c }) });
      await expect(prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).rejects.toMatchObject({ status: 422 });
    }
    rpc.accounts.delete(bondingCurve(starlet.mint));
    await expect(prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).rejects.toThrow(/No Pump bonding curve/);
  });

  it("returns no transaction when the simulation fails, and 503 when Solana is unreachable", async () => {
    rpc.simErr = { InstructionError: [1, { Custom: 6014 }] };
    await expect(prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).rejects.toThrow(/Simulation failed/);
    rpc.simErr = null;
    rpc.outage = true;
    await expect(prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses until all three treasury wallets are registered", async () => {
    await db().treasuryWallet.deleteMany({ where: { role: "OPERATIONS" } });
    await expect(prepareFeeSharingSetup(starlet.mint, creator, ADMIN)).rejects.toThrow(/treasury wallets/);
  });

  it("decodes older (shorter) bonding curve layouts with safe defaults", () => {
    const old = curve({ creator }).subarray(0, 81);
    expect(decodeBondingCurve(old)).toEqual({ complete: false, creator, quoteMint: null, isHolderReward: false, pendingCreatorFee: 0n });
  });

  it("is ADMIN-only over the API and ignores any shareholders in the request", async () => {
    await signInAs("EDITOR");
    expect((await setupRoute(send("POST", "/api/admin/demolition-fund/fee-sharing/setup", { mint: starlet.mint, creator }))).status).toBe(403);
    await signInAs("ADMIN");
    const extra = await setupRoute(send("POST", "/api/admin/demolition-fund/fee-sharing/setup", { mint: starlet.mint, creator, shareholders: [{ address: newKey(), shareBps: 10_000 }] }));
    expect(extra.status).toBe(400); // strict body: unknown fields rejected
    const ok = await setupRoute(send("POST", "/api/admin/demolition-fund/fee-sharing/setup", { mint: starlet.mint, creator }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).shareholders).toEqual(expected());
  });
});
