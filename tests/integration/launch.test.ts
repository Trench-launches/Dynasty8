import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AddressLookupTableAccount, AddressLookupTableProgram, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { setSessionResolverForTests } from "@/server/auth/admin";
import { setPumpSetupRpcForTests, CREATE_FEE_SHARING_CONFIG, UPDATE_FEE_SHARES_V2, type PumpSetupRpc } from "@/server/demolition/fee-sharing-setup";
import { CREATE_V2, staticLaunchAccounts, validateCoinArgs } from "@/server/demolition/launch-builder";
import { listLaunchCoins, prepareAtomicLaunch, prepareLookupTable } from "@/server/demolition/launch";
import { PUMP_PROGRAMS } from "@/server/demolition/pump-fees";
import { GET as listRoute } from "@/app/api/admin/demolition-fund/launch/route";
import { POST as prepareRoute } from "@/app/api/admin/demolition-fund/launch/prepare/route";
import { db, get, newKey, resetDatabase, send, signInAs } from "../helpers/fixtures";

const ADMIN = { id: "admin-1", label: "test-admin" };
const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as { multisig: string; wallets: { role: "FUND" | "ECOSYSTEM" | "OPERATIONS"; vaultIndex: number; address: string; shareBps: number }[] };
const holders = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
const URI = "https://ipfs.io/ipfs/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

class FakeRpc implements PumpSetupRpc {
  accounts = new Map<string, { owner: string; data: Buffer }>();
  tables = new Map<string, AddressLookupTableAccount>();
  simErr: unknown = null;
  simulated: VersionedTransaction[] = [];
  async getAccount(a: string) {
    return this.accounts.get(a) ?? null;
  }
  async getLatestBlockhash() {
    return PublicKey.default.toBase58();
  }
  async getSlot() {
    return 5_000;
  }
  async getLookupTable(a: string) {
    return this.tables.get(a) ?? null;
  }
  async simulate(tx: VersionedTransaction) {
    this.simulated.push(tx);
    return { err: this.simErr, logs: this.simErr ? ["Program log: AnchorError Error Code: X", "failed"] : ["success"], unitsConsumed: 250_000 };
  }
}

let rpc: FakeRpc;
let table: string;
const creator = newKey();

beforeEach(async () => {
  await resetDatabase();
  // The owner-confirmed treasury, registered as the production command would (ON_CHAIN_SPLIT).
  await db().treasuryWallet.createMany({
    data: treasury.wallets.map((w) => ({ role: w.role, address: w.address, label: w.role, isMultisig: true, multisigAddress: treasury.multisig, vaultIndex: w.vaultIndex, multisigThreshold: 2, multisigMembers: 3, multisigVerifiedAt: new Date() })),
  });
  await db().fundConfig.upsert({ where: { id: 1 }, create: { id: 1, allocationMode: "ON_CHAIN_SPLIT" }, update: { allocationMode: "ON_CHAIN_SPLIT" } });
  rpc = new FakeRpc();
  setPumpSetupRpcForTests(rpc);
  table = newKey();
  rpc.tables.set(
    table,
    new AddressLookupTableAccount({ key: new PublicKey(table), state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: staticLaunchAccounts(holders).map((a) => new PublicKey(a)) } }),
  );
});

afterEach(() => {
  setPumpSetupRpcForTests(null);
  setSessionResolverForTests(null);
});

function decode(base64: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const alt = rpc.tables.get(table)!;
  const keys = [...tx.message.staticAccountKeys.map((k) => k.toBase58()), ...tx.message.getAccountKeys({ addressLookupTableAccounts: [alt] }).keySegments().slice(1).flat().map((k) => k.toBase58())];
  return { tx, keys };
}

describe("atomic launch: create_v2 + fee sharing locked to the treasury in one transaction", () => {
  it("lists DYNASTY and the 15 property coins with their decision status", async () => {
    const coins = await listLaunchCoins();
    expect(coins).toHaveLength(16);
    expect(coins.filter((c) => c.status === "PENDING_DECISION").map((c) => c.symbol).sort()).toEqual(["BOATWORKS", "DYNASTY"]);
    expect(coins.every((c) => c.registered.mint === null)).toBe(true);
  });

  it("builds one unsigned, simulated transaction signed by the creator and a fresh mint", async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const r = await prepareAtomicLaunch({ slug: "starlet-motel", creator, mint, uri: URI, lookupTable: table }, ADMIN);
    expect(r).toMatchObject({ symbol: "STARLET", name: "Starlet Motel", mint, shareholders: holders, simulation: { ok: true, unitsConsumed: 250_000 } });
    const { tx, keys } = decode(r.transactionBase64);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(tx.message.staticAccountKeys.slice(0, 2).map((k) => k.toBase58()).sort()).toEqual([creator, mint].sort());
    expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(creator); // fee payer
    expect(tx.message.addressTableLookups).toHaveLength(1);
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);

    const ixs = tx.message.compiledInstructions.filter((ix) => keys[ix.programIdIndex] !== "ComputeBudget111111111111111111111111111111");
    expect(keys[ixs[0]!.programIdIndex]).toBe(PUMP_PROGRAMS.pump);
    const create = Buffer.from(ixs[0]!.data);
    expect(create.subarray(0, 8)).toEqual(CREATE_V2);
    expect(create.includes(Buffer.from("Starlet Motel"))).toBe(true);
    expect(create.includes(Buffer.from(URI))).toBe(true);
    expect(create.subarray(create.length - 33, create.length - 1)).toEqual(new PublicKey(creator).toBuffer()); // creator arg
    expect(Buffer.from(ixs[1]!.data)).toEqual(CREATE_FEE_SHARING_CONFIG);
    const upd = Buffer.from(ixs[2]!.data);
    expect(upd.subarray(0, 8)).toEqual(UPDATE_FEE_SHARES_V2);
    const shares = Array.from({ length: upd.readUInt32LE(8) }, (_, i) => ({ address: new PublicKey(upd.subarray(12 + i * 34, 44 + i * 34)).toBase58(), shareBps: upd.readUInt16LE(44 + i * 34) }));
    expect(shares).toEqual(holders);
    expect(r.transactionBytes).toBeLessThanOrEqual(1232);
    expect(await db().auditLog.count({ where: { action: "launch.prepared" } })).toBe(1);
  });

  it("refuses coins waiting on an owner decision, launched coins, reused mints and bad inputs", async () => {
    const mint = () => Keypair.generate().publicKey.toBase58();
    await expect(prepareAtomicLaunch({ slug: "brians-boat-works-and-marina", creator, mint: mint(), uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/owner decision/);
    await expect(prepareAtomicLaunch({ slug: "dynasty", creator, mint: mint(), uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/owner decision/);
    await expect(prepareAtomicLaunch({ slug: "nope", creator, mint: mint(), uri: URI, lookupTable: table }, ADMIN)).rejects.toMatchObject({ status: 404 });
    await expect(prepareAtomicLaunch({ slug: "starlet-motel", creator, mint: creator, uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/fresh keypair/);
    await expect(prepareAtomicLaunch({ slug: "starlet-motel", creator, mint: mint(), uri: "http://insecure", lookupTable: table }, ADMIN)).rejects.toThrow(/https/);
    await expect(prepareAtomicLaunch({ slug: "starlet-motel", creator, mint: mint(), uri: URI, lookupTable: newKey() }, ADMIN)).rejects.toThrow(/Lookup table/);

    const used = mint();
    rpc.accounts.set(used, { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: Buffer.alloc(82) });
    await expect(prepareAtomicLaunch({ slug: "starlet-motel", creator, mint: used, uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/already exists/);

    const t = await db().token.findFirstOrThrow({ where: { property: { slug: "starlet-motel" } } });
    await db().token.update({ where: { id: t.id }, data: { mintAddress: mint(), deploymentStatus: "PENDING_VERIFICATION" } });
    await expect(prepareAtomicLaunch({ slug: "starlet-motel", creator, mint: mint(), uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/already has a registered mint/);
  });

  it("refuses when the registered treasury differs from the launch config, or simulation fails", async () => {
    rpc.simErr = { InstructionError: [3, { Custom: 6014 }] };
    await expect(prepareAtomicLaunch({ slug: "keys-safehouse".replace("keys-safehouse", "leonida-keys-safehouse"), creator, mint: Keypair.generate().publicKey.toBase58(), uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/Simulation failed/);
    rpc.simErr = null;
    await db().treasuryWallet.update({ where: { role: "OPERATIONS" }, data: { address: newKey() } });
    await expect(prepareAtomicLaunch({ slug: "leonida-keys-safehouse", creator, mint: Keypair.generate().publicKey.toBase58(), uri: URI, lookupTable: table }, ADMIN)).rejects.toThrow(/differ from the registered treasury/);
  });

  it("prepares the project lookup table with every fixed launch account", async () => {
    const r = await prepareLookupTable(creator, ADMIN);
    expect(r.addresses).toEqual(staticLaunchAccounts(holders));
    expect(r.addresses).toContain(PUMP_PROGRAMS.pump);
    expect(r.addresses).toContain(PUMP_PROGRAMS.fees);
    // The vaults are instruction data (update_fee_shares_v2), not accounts, so they are not in the table.
    for (const h of holders) expect(r.addresses).not.toContain(h.address);
    const tx = VersionedTransaction.deserialize(Buffer.from(r.transactionBase64, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys[0]).toBe(creator);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    expect(tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex])).toEqual([AddressLookupTableProgram.programId.toBase58(), AddressLookupTableProgram.programId.toBase58()]);
  });

  it("validates Pump's limits on name, symbol and metadata URL", () => {
    expect(validateCoinArgs({ name: "x".repeat(33), symbol: "TOOLONGSYMBOL1", uri: "ftp://x" })).toHaveLength(3);
    expect(validateCoinArgs({ name: "Starlet Motel", symbol: "STARLET", uri: URI })).toEqual([]);
  });

  it("is ADMIN-only for preparing and VIEWER+ for listing", async () => {
    await signInAs("VIEWER");
    expect((await listRoute(get("/api/admin/demolition-fund/launch"))).status).toBe(200);
    const body = { slug: "starlet-motel", creator, mint: Keypair.generate().publicKey.toBase58(), uri: URI, lookupTable: table };
    expect((await prepareRoute(send("POST", "/api/admin/demolition-fund/launch/prepare", body))).status).toBe(403);
    await signInAs("ADMIN");
    expect((await prepareRoute(send("POST", "/api/admin/demolition-fund/launch/prepare", { ...body, name: "Other" }))).status).toBe(400); // name is never taken from the request
    expect((await prepareRoute(send("POST", "/api/admin/demolition-fund/launch/prepare", body))).status).toBe(200);
  });
});
