import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AddressLookupTableAccount, AddressLookupTableProgram, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { setSessionResolverForTests } from "@/server/auth/admin";
import { setPumpSetupRpcForTests, CREATE_FEE_SHARING_CONFIG, UPDATE_FEE_SHARES_V2, type PumpSetupRpc } from "@/server/demolition/fee-sharing-setup";
import {
  bondingCurveAddress,
  BUY_EXACT_QUOTE_IN_V3,
  CREATE_V2,
  FEE_CONFIG_DISCRIMINATOR,
  expectedTokensOut,
  pumpFeeConfigAddress,
  pumpGlobalAddress,
  staticLaunchAccounts,
  tokensOutAtReserves,
  validateCoinArgs,
} from "@/server/demolition/launch-builder";
import { FALLBACK_GAP_RISK, listLaunchCoins, prepareAtomicLaunch, prepareLookupTable, prepareSplitCreate, prepareSplitDevBuy, setReleasePlanForTests, type ReleasePlan } from "@/server/demolition/launch";
import { setResourceFetcherForTests } from "@/server/demolition/launch-metadata";
import { PUMP_PROGRAMS, sharingConfigAddress, SHARING_CONFIG_DISCRIMINATOR } from "@/server/demolition/pump-fees";
import { GET as listRoute } from "@/app/api/admin/demolition-fund/launch/route";
import { POST as prepareRoute } from "@/app/api/admin/demolition-fund/launch/prepare/route";
import { POST as splitRoute } from "@/app/api/admin/demolition-fund/launch/prepare-split/route";
import { db, get, newKey, resetDatabase, send, signInAs } from "../helpers/fixtures";

/**
 * Atomic launch preparation (MOCKED chain and gateway; the read-only mainnet evidence is
 * scripts/verify/simulate-launches.ts). Covers Option C, 60/25/15, the 0.01 SOL dev buy, the launch
 * wallet gate, release order, metadata verification and failed / partial preparations.
 */
const ADMIN = { id: "admin-1", label: "test-admin" };
const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as { multisig: string; wallets: { role: "FUND" | "ECOSYSTEM" | "OPERATIONS"; vaultIndex: number; address: string; shareBps: number }[] };
const propertyHolders = treasury.wallets.map((w) => ({ address: w.address, shareBps: w.shareBps }));
const FUND = treasury.wallets[0]!.address;
const dynastyCfg = JSON.parse(readFileSync("config/launch/dynasty.mainnet.json", "utf8")).coin;
const propsCfg = JSON.parse(readFileSync("config/launch/properties.mainnet.json", "utf8")).coins as { slug: string; metadata: Record<string, unknown>; launchImage: string | null }[];
const LAUNCH_WALLET = newKey();
/** Owner decision: the property coins deploy from a different wallet than $DYNASTY. */
const PROPERTY_WALLET = newKey();
const walletFor = (slug: string) => (slug === "dynasty" ? LAUNCH_WALLET : PROPERTY_WALLET);
const RECIPIENT = newKey();
const URI = (slug: string) => `https://ipfs.io/ipfs/Qm${slug.replace(/[^a-z]/g, "").padEnd(44, "x").slice(0, 44)}`;
const IMG = (slug: string) => `https://ipfs.io/ipfs/QmImg${slug.replace(/[^a-z]/g, "").padEnd(41, "x").slice(0, 41)}`;

function globalData() {
  const b = Buffer.alloc(1100);
  b.writeBigUInt64LE(1_073_000_000_000_000n, 73);
  b.writeBigUInt64LE(30_000_000_000n, 81);
  for (let i = 0; i < 8; i++) (i === 0 ? new PublicKey(RECIPIENT) : Keypair.generate().publicKey).toBuffer().copy(b, 741 + i * 32);
  return b;
}
function feeConfigData() {
  const b = Buffer.alloc(8 + 1 + 32 + 24 + 4 + 16 + 24);
  FEE_CONFIG_DISCRIMINATOR.copy(b, 0);
  b.writeUInt32LE(1, 8 + 1 + 32 + 24);
  const t = 8 + 1 + 32 + 24 + 4 + 16;
  b.writeBigUInt64LE(0n, t);
  b.writeBigUInt64LE(95n, t + 8);
  b.writeBigUInt64LE(30n, t + 16);
  return b;
}

class FakeRpc implements PumpSetupRpc {
  accounts = new Map<string, { owner: string; data: Buffer }>([
    [pumpGlobalAddress(), { owner: PUMP_PROGRAMS.pump, data: globalData() }],
    [pumpFeeConfigAddress(), { owner: PUMP_PROGRAMS.fees, data: feeConfigData() }],
  ]);
  tables = new Map<string, AddressLookupTableAccount>();
  balance = 1_000_000_000;
  simErr: unknown = null;
  simulated = 0;
  async getAccount(a: string) {
    return this.accounts.get(a) ?? null;
  }
  async getLatestBlockhash() {
    return PublicKey.default.toBase58();
  }
  async getSlot() {
    return 5_000;
  }
  async getBalance() {
    return this.balance;
  }
  async getLookupTable(a: string) {
    return this.tables.get(a) ?? null;
  }
  async simulate() {
    this.simulated++;
    return { err: this.simErr, logs: this.simErr ? ["Program log: AnchorError Error Code: X", "failed"] : ["success"], unitsConsumed: 340_000 };
  }
}

/** Gateway stub serving each coin's committed metadata and its real launch image bytes. */
function gateway(over: { slug?: string; badImage?: boolean; badName?: boolean; status404?: boolean } = {}) {
  const coins = [dynastyCfg, ...propsCfg] as { slug: string; metadata: Record<string, unknown>; launchImage: string | null }[];
  setResourceFetcherForTests(async (url) => {
    if (over.status404) return { ok: false, status: 404, bytes: new Uint8Array() };
    for (const c of coins) {
      if (url === URI(c.slug)) {
        const m = { ...c.metadata, image: IMG(c.slug), ...(over.badName && over.slug === c.slug ? { name: "Imposter" } : {}) };
        return { ok: true, status: 200, bytes: new TextEncoder().encode(JSON.stringify(m)) };
      }
      if (url === IMG(c.slug) && c.launchImage) return { ok: true, status: 200, bytes: over.badImage ? new Uint8Array([1, 2, 3]) : new Uint8Array(readFileSync(c.launchImage)) };
    }
    return { ok: false, status: 404, bytes: new Uint8Array() };
  });
}

let rpc: FakeRpc;
let table: string;
let propertyTable: string;
const plan = (over: Partial<ReleasePlan> = {}): ReleasePlan => ({ launchWallet: LAUNCH_WALLET, propertyLaunchWallet: PROPERTY_WALLET, lookupTable: null, devBuyLamports: "10000000", slippageBps: 300, priorityMicroLamports: 50_000, approvedProperties: ["starlet-motel", "ocean-view-hotel"], ...over });

beforeEach(async () => {
  await resetDatabase();
  await db().treasuryWallet.createMany({
    data: treasury.wallets.map((w) => ({ role: w.role, address: w.address, label: w.role, isMultisig: true, multisigAddress: treasury.multisig, vaultIndex: w.vaultIndex, multisigThreshold: 2, multisigMembers: 3, multisigVerifiedAt: new Date() })),
  });
  await db().fundConfig.upsert({ where: { id: 1 }, create: { id: 1, allocationMode: "ON_CHAIN_SPLIT" }, update: { allocationMode: "ON_CHAIN_SPLIT" } });
  rpc = new FakeRpc();
  setPumpSetupRpcForTests(rpc);
  setReleasePlanForTests(plan());
  gateway();
  // Each launch wallet has its own lookup table (it holds the wallet's own WSOL account and volume accumulator).
  const makeTable = (owner: string) => {
    const key = newKey();
    rpc.tables.set(
      key,
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: staticLaunchAccounts(propertyHolders, { buybackFeeRecipient: RECIPIENT, launchWallet: owner }).map((a) => new PublicKey(a)) },
      }),
    );
    return key;
  };
  table = makeTable(LAUNCH_WALLET);
  propertyTable = makeTable(PROPERTY_WALLET);
});

afterEach(() => {
  setPumpSetupRpcForTests(null);
  setReleasePlanForTests(null);
  setResourceFetcherForTests(null);
  setSessionResolverForTests(null);
});

const mint = () => Keypair.generate().publicKey.toBase58();
const launch = (slug: string, over: Partial<{ creator: string; mint: string; uri: string; lookupTable: string }> = {}) =>
  prepareAtomicLaunch({ slug, creator: walletFor(slug), mint: mint(), uri: URI(slug), lookupTable: slug === "dynasty" ? table : propertyTable, ...over }, ADMIN);
async function markLaunched(slug: string) {
  const t = slug === "dynasty" ? await db().token.findFirstOrThrow({ where: { isNative: true } }) : await db().token.findFirstOrThrow({ where: { property: { slug } } });
  await db().token.update({ where: { id: t.id }, data: { mintAddress: mint(), deploymentStatus: "PENDING_VERIFICATION" } });
  return t.id;
}

function decode(base64: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const alts = [rpc.tables.get(table)!, rpc.tables.get(propertyTable)!];
  const keys = tx.message.getAccountKeys({ addressLookupTableAccounts: alts }).keySegments().flat().map((k) => k.toBase58());
  const ixs = tx.message.compiledInstructions.map((ix) => ({ program: keys[ix.programIdIndex]!, data: Buffer.from(ix.data), accounts: ix.accountKeyIndexes.map((i) => keys[i]!) }));
  return { tx, keys, ixs };
}
const shares = (data: Buffer) => Array.from({ length: data.readUInt32LE(8) }, (_, i) => ({ address: new PublicKey(data.subarray(12 + i * 34, 44 + i * 34)).toBase58(), shareBps: data.readUInt16LE(44 + i * 34) }));

describe("atomic launch with locked fee sharing and the 0.01 SOL dev buy (mocked chain)", () => {
  it("lists DYNASTY and exactly 15 property coins with policy, approval and CROSSTOWN pending", async () => {
    const coins = await listLaunchCoins();
    expect(coins).toHaveLength(16);
    expect(coins.filter((c) => c.kind === "PROPERTY")).toHaveLength(15);
    expect(coins.find((c) => c.symbol === "DYNASTY")).toMatchObject({ policy: "DYNASTY_FUND_100", status: "READY_FOR_OWNER_REVIEW", approved: true });
    expect(coins.find((c) => c.symbol === "CROSSTOWN")).toMatchObject({ status: "PENDING_DECISION" });
    expect(coins.find((c) => c.symbol === "BOATWORKS")).toBeUndefined();
    expect(coins.find((c) => c.symbol === "STARLET")).toMatchObject({ policy: "PROPERTY_60_25_15", approved: true });
    expect(coins.find((c) => c.symbol === "KEYS")).toMatchObject({ approved: false });
  });

  it("$DYNASTY: create + 100% FUND fee sharing (Option C) + 0.01 SOL buy in one transaction", async () => {
    const m = mint();
    const r = await launch("dynasty", { mint: m });
    expect(r).toMatchObject({ symbol: "DYNASTY", policy: "DYNASTY_FUND_100", shareholders: [{ address: FUND, shareBps: 10_000 }], priorityMicroLamports: 50_000 });
    const { tx, ixs } = decode(r.transactionBase64);
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(tx.message.staticAccountKeys.slice(0, 2).map((k) => k.toBase58()).sort()).toEqual([LAUNCH_WALLET, m].sort());
    expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(LAUNCH_WALLET);
    const pump = ixs.filter((ix) => ix.program === PUMP_PROGRAMS.pump || ix.program === PUMP_PROGRAMS.fees);
    expect(pump[0]!.data.subarray(0, 8)).toEqual(CREATE_V2);
    expect(pump[1]!.data).toEqual(CREATE_FEE_SHARING_CONFIG);
    expect(pump[2]!.data.subarray(0, 8)).toEqual(UPDATE_FEE_SHARES_V2);
    expect(shares(pump[2]!.data)).toEqual([{ address: FUND, shareBps: 10_000 }]); // NOT the property split
    const buy = pump[3]!;
    expect(buy.data.subarray(0, 8)).toEqual(BUY_EXACT_QUOTE_IN_V3);
    expect(buy.data.readBigUInt64LE(8)).toBe(10_000_000n); // exactly 0.01 SOL
    const expected = expectedTokensOut(10_000_000n, { initialVirtualTokenReserves: 1_073_000_000_000_000n, initialVirtualSolReserves: 30_000_000_000n, buybackFeeRecipients: [] }, 125);
    expect(buy.data.readBigUInt64LE(16)).toBe((expected * 9_700n) / 10_000n); // 3% slippage floor
    expect(buy.accounts).toContain(RECIPIENT);
    expect(r.devBuy).toMatchObject({ lamports: "10000000", expectedTokens: expected.toString(), slippageBps: 300 });
    expect(r.transactionBytes).toBeLessThanOrEqual(1232);
    expect(r.metadata.imageSha256).toBe(dynastyCfg.launchImageSha256);
  });

  it("property coin: 60/25/15 shares and the 0.01 SOL buy, after $DYNASTY", async () => {
    await markLaunched("dynasty");
    const r = await launch("starlet-motel");
    const { ixs } = decode(r.transactionBase64);
    const upd = ixs.find((ix) => ix.data.subarray(0, 8).equals(UPDATE_FEE_SHARES_V2))!;
    expect(shares(upd.data)).toEqual(propertyHolders);
    expect(ixs.find((ix) => ix.data.subarray(0, 8).equals(BUY_EXACT_QUOTE_IN_V3))!.data.readBigUInt64LE(8)).toBe(10_000_000n);
    expect(r.transactionBytes).toBeLessThanOrEqual(1232);
  });

  it("only the approved launch wallet can prepare launches or the lookup table", async () => {
    setReleasePlanForTests(plan({ launchWallet: null, propertyLaunchWallet: null }));
    await expect(launch("dynasty")).rejects.toThrow(/No \$DYNASTY launch wallet is set/);
    await expect(prepareLookupTable(LAUNCH_WALLET, ADMIN)).rejects.toThrow(/No launch wallet is set/);
    setReleasePlanForTests(plan());
    await expect(launch("dynasty", { creator: newKey() })).rejects.toMatchObject({ status: 403 });
    await expect(prepareLookupTable(newKey(), ADMIN)).rejects.toMatchObject({ status: 403 });
  });

  it("deploys $DYNASTY and the property coins from two different wallets", async () => {
    // $DYNASTY only from launchWallet, never from the property wallet.
    await expect(launch("dynasty", { creator: PROPERTY_WALLET })).rejects.toThrow(/not the approved \$DYNASTY launch wallet/);
    await markLaunched("dynasty");
    // Properties only from propertyLaunchWallet, never from the $DYNASTY wallet.
    await expect(launch("starlet-motel", { creator: LAUNCH_WALLET })).rejects.toThrow(/not the approved property launch wallet/);
    await expect(launch("starlet-motel")).resolves.toMatchObject({ creator: PROPERTY_WALLET, symbol: "STARLET" });
    // Unset: property launches refused, $DYNASTY unaffected.
    setReleasePlanForTests(plan({ propertyLaunchWallet: null }));
    await expect(launch("starlet-motel")).rejects.toThrow(/No property launch wallet is set/);
    // The same wallet in both fields is refused (it must be a different wallet).
    setReleasePlanForTests(plan({ propertyLaunchWallet: LAUNCH_WALLET }));
    await expect(launch("starlet-motel", { creator: LAUNCH_WALLET })).rejects.toThrow(/must be a different wallet/);
    // Each wallet prepares its own lookup table, holding its own accounts.
    setReleasePlanForTests(plan());
    const own = await prepareLookupTable(PROPERTY_WALLET, ADMIN);
    expect(own.addresses).toEqual(staticLaunchAccounts(propertyHolders, { buybackFeeRecipient: RECIPIENT, launchWallet: PROPERTY_WALLET }));
    // listLaunchCoins tells the page which wallet each coin deploys from.
    const coins = await listLaunchCoins();
    expect(coins.find((c) => c.symbol === "DYNASTY")?.launchWallet).toBe(LAUNCH_WALLET);
    expect(coins.find((c) => c.symbol === "STILT")?.launchWallet).toBe(PROPERTY_WALLET);
  });

  it("enforces the release order: DYNASTY, one approved property, verify, controlled buyback, then more", async () => {
    await expect(launch("starlet-motel")).rejects.toThrow(/Launch \$DYNASTY first/);
    await markLaunched("dynasty");
    await expect(launch("leonida-keys-safehouse")).rejects.toThrow(/not approved for launch/);
    await expect(launch("cross-town-safehouse")).rejects.toThrow(/owner decision/);
    await launch("starlet-motel"); // the first property coin may be prepared
    const starletId = await markLaunched("starlet-motel");
    await expect(launch("ocean-view-hotel")).rejects.toThrow(/Verify the fee-sharing config/);
    const nativeId = (await db().token.findFirstOrThrow({ where: { isNative: true } })).id;
    for (const id of [nativeId, starletId]) {
      const t = await db().token.findUniqueOrThrow({ where: { id } });
      await db().feeSharingCheck.create({ data: { tokenId: id, mint: t.mintAddress!, sharingConfig: newKey(), exists: true, matches: true, issues: [] } });
    }
    await expect(launch("ocean-view-hotel")).rejects.toThrow(/controlled buyback-and-burn/);
    await db().buybackRequest.create({
      data: { idempotencyKey: "controlled-cycle", status: "BURNED", targetMint: newKey(), budgetLamports: 1_000_000n, slippageBps: 100, tokensReceivedRaw: 5n, tokensBurnedRaw: 5n },
    });
    expect((await launch("ocean-view-hotel")).symbol).toBe("OCEAN");
  });

  it("verifies the pinned metadata and image before preparing anything", async () => {
    gateway({ badImage: true });
    await expect(launch("dynasty")).rejects.toThrow(/image content does not match/);
    gateway({ slug: "dynasty", badName: true });
    await expect(launch("dynasty")).rejects.toThrow(/"name" does not match/);
    gateway({ status404: true });
    await expect(launch("dynasty")).rejects.toThrow(/HTTP 404/);
    gateway();
    await expect(launch("dynasty", { uri: "http://insecure.example/x.json" })).rejects.toThrow(/https/);
    expect(rpc.simulated).toBe(0); // nothing was built or simulated for a failed verification
  });

  it("refuses an underfunded launch wallet, a reused mint, a missing lookup table and failed simulations; prepares nothing durable", async () => {
    rpc.balance = 40_000_000;
    await expect(launch("dynasty")).rejects.toThrow(/needs at least 60000000/);
    rpc.balance = 1_000_000_000;
    const used = mint();
    rpc.accounts.set(used, { owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", data: Buffer.alloc(82) });
    await expect(launch("dynasty", { mint: used })).rejects.toThrow(/already exists/);
    await expect(launch("dynasty", { lookupTable: newKey() })).rejects.toThrow(/Lookup table/);
    rpc.simErr = { InstructionError: [3, { Custom: 6014 }] };
    await expect(launch("dynasty")).rejects.toThrow(/Simulation failed/);
    rpc.simErr = null;
    // A prepared-but-never-sent launch changes nothing: the token has no mint and can be prepared again.
    expect((await db().token.findFirstOrThrow({ where: { isNative: true } })).mintAddress).toBeNull();
    await launch("dynasty");
    await launch("dynasty");
    expect((await db().token.findFirstOrThrow({ where: { isNative: true } })).mintAddress).toBeNull();
  });

  it("refuses when the registered treasury differs from the launch config (wrong vaults)", async () => {
    await db().treasuryWallet.update({ where: { role: "FUND" }, data: { address: newKey() } });
    await expect(launch("dynasty")).rejects.toThrow(/differ from the registered treasury/);
  });

  it("prepares the project lookup table (statics + the launch wallet's accounts) in transactions that fit", async () => {
    const r = await prepareLookupTable(LAUNCH_WALLET, ADMIN);
    expect(r.addresses).toEqual(staticLaunchAccounts(propertyHolders, { buybackFeeRecipient: RECIPIENT, launchWallet: LAUNCH_WALLET }));
    expect(r.addresses).toContain(pumpFeeConfigAddress());
    expect(r.addresses).toContain(RECIPIENT);
    expect(r.transactions.length).toBeGreaterThanOrEqual(1);
    for (const t of r.transactions) {
      expect(t.transactionBytes).toBeLessThanOrEqual(1232);
      const tx = VersionedTransaction.deserialize(Buffer.from(t.transactionBase64, "base64"));
      expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(LAUNCH_WALLET);
      expect(tx.message.header.numRequiredSignatures).toBe(1);
      for (const ix of tx.message.compiledInstructions) expect(tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58()).toBe(AddressLookupTableProgram.programId.toBase58());
    }
  });

  it("validates Pump's limits on name, symbol and metadata URL", () => {
    expect(validateCoinArgs({ name: "x".repeat(33), symbol: "TOOLONGSYMBOL1", uri: "ftp://x" })).toHaveLength(3);
    expect(validateCoinArgs({ name: "Starlet Motel", symbol: "STARLET", uri: URI("starlet-motel") })).toEqual([]);
  });

  it("is ADMIN-only for preparing, VIEWER+ for listing, and never takes coin details from the request", async () => {
    await signInAs("VIEWER");
    expect((await listRoute(get("/api/admin/demolition-fund/launch"))).status).toBe(200);
    const body = { slug: "dynasty", creator: LAUNCH_WALLET, mint: mint(), uri: URI("dynasty"), lookupTable: table };
    expect((await prepareRoute(send("POST", "/api/admin/demolition-fund/launch/prepare", body))).status).toBe(403);
    await signInAs("ADMIN");
    expect((await prepareRoute(send("POST", "/api/admin/demolition-fund/launch/prepare", { ...body, shareholders: [] }))).status).toBe(400);
    expect((await prepareRoute(send("POST", "/api/admin/demolition-fund/launch/prepare", body))).status).toBe(200);
  });
});

describe("fallback: separate transactions (mocked chain)", () => {
  const curve = (p: { vt?: bigint; vq?: bigint; complete?: boolean } = {}) => {
    const b = Buffer.alloc(150);
    b.writeBigUInt64LE(p.vt ?? 1_000_000_000_000_000n, 8); // live reserves differ from a fresh curve
    b.writeBigUInt64LE(p.vq ?? 32_000_000_000n, 16);
    b[48] = p.complete ? 1 : 0;
    new PublicKey(LAUNCH_WALLET).toBuffer().copy(b, 49);
    return b;
  };
  const sharingCfg = (m: string, holders: { address: string; shareBps: number }[], revoked = true) => {
    const n = Buffer.alloc(4);
    n.writeUInt32LE(holders.length);
    return Buffer.concat([
      SHARING_CONFIG_DISCRIMINATOR,
      Buffer.from([255, 2, 1]),
      new PublicKey(m).toBuffer(),
      new PublicKey(LAUNCH_WALLET).toBuffer(),
      Buffer.from([revoked ? 1 : 0]),
      n,
      ...holders.flatMap((h) => {
        const s = Buffer.alloc(2);
        s.writeUInt16LE(h.shareBps);
        return [new PublicKey(h.address).toBuffer(), s];
      }),
    ]);
  };
  const split = (slug: string, ack = true, over: Partial<{ creator: string }> = {}) =>
    prepareSplitCreate({ slug, creator: walletFor(slug), mint: mint(), uri: URI(slug), acknowledgeGapRisk: ack, ...over }, ADMIN);

  it("step 1 needs the gap-risk acknowledgment, applies every launch gate, and creates the coin only", async () => {
    await expect(split("dynasty", false)).rejects.toThrow(/Acknowledge the fallback risk.*NOT the treasury/s);
    await expect(split("dynasty", true, { creator: newKey() })).rejects.toMatchObject({ status: 403 });
    await expect(split("starlet-motel")).rejects.toThrow(/Launch \$DYNASTY first/);
    gateway({ badImage: true });
    await expect(split("dynasty")).rejects.toThrow(/image content does not match/);
    gateway();
    const r = await split("dynasty");
    expect(r).toMatchObject({ step: 1, symbol: "DYNASTY" });
    expect(r.risk).toBe(FALLBACK_GAP_RISK);
    expect(r.risk).toMatch(/guaranteed only from step 2 onward/);
    const tx = VersionedTransaction.deserialize(Buffer.from(r.transactionBase64, "base64"));
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]);
    expect(programs.filter((p) => p === PUMP_PROGRAMS.pump)).toHaveLength(1); // create_v2 only
    expect(programs).not.toContain(PUMP_PROGRAMS.fees); // no fee sharing in step 1
    const create = tx.message.compiledInstructions.find((ix) => keys[ix.programIdIndex] === PUMP_PROGRAMS.pump)!;
    expect(Buffer.from(create.data.subarray(0, 8))).toEqual(CREATE_V2);
    expect(await db().auditLog.count({ where: { action: "launch.split_create_prepared" } })).toBe(1);
  });

  it("step 3 (dev buy) is refused until fee sharing is locked on-chain with exactly the expected shareholders", async () => {
    await expect(prepareSplitDevBuy({ slug: "dynasty", creator: LAUNCH_WALLET }, ADMIN)).rejects.toThrow(/Register DYNASTY's mint first/);
    await markLaunched("dynasty");
    const m = (await db().token.findFirstOrThrow({ where: { isNative: true } })).mintAddress!;
    rpc.accounts.set(bondingCurveAddress(m), { owner: PUMP_PROGRAMS.pump, data: curve() });
    await expect(prepareSplitDevBuy({ slug: "dynasty", creator: LAUNCH_WALLET }, ADMIN)).rejects.toThrow(/not locked/); // no config
    rpc.accounts.set(sharingConfigAddress(m), { owner: PUMP_PROGRAMS.fees, data: sharingCfg(m, [{ address: FUND, shareBps: 10_000 }], false) });
    await expect(prepareSplitDevBuy({ slug: "dynasty", creator: LAUNCH_WALLET }, ADMIN)).rejects.toThrow(/not locked/); // not revoked
    rpc.accounts.set(sharingConfigAddress(m), { owner: PUMP_PROGRAMS.fees, data: sharingCfg(m, propertyHolders) });
    await expect(prepareSplitDevBuy({ slug: "dynasty", creator: LAUNCH_WALLET }, ADMIN)).rejects.toThrow(/not locked/); // wrong policy for DYNASTY
    rpc.accounts.set(sharingConfigAddress(m), { owner: PUMP_PROGRAMS.fees, data: sharingCfg(m, [{ address: FUND, shareBps: 10_000 }]) });
    await expect(prepareSplitDevBuy({ slug: "dynasty", creator: newKey() }, ADMIN)).rejects.toMatchObject({ status: 403 });
    const r = await prepareSplitDevBuy({ slug: "dynasty", creator: LAUNCH_WALLET }, ADMIN);
    const live = tokensOutAtReserves(10_000_000n, { virtualTokenReserves: 1_000_000_000_000_000n, virtualQuoteReserves: 32_000_000_000n }, 125);
    expect(r.devBuy).toMatchObject({ lamports: "10000000", expectedTokens: live.toString(), minTokensOut: ((live * 9_700n) / 10_000n).toString() });
    const tx = VersionedTransaction.deserialize(Buffer.from(r.transactionBase64, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    const buy = tx.message.compiledInstructions.find((ix) => Buffer.from(ix.data.subarray(0, 8)).equals(BUY_EXACT_QUOTE_IN_V3))!;
    expect(Buffer.from(buy.data).readBigUInt64LE(8)).toBe(10_000_000n);
    expect(keys[0]).toBe(LAUNCH_WALLET);
    expect(tx.message.header.numRequiredSignatures).toBe(1);
    rpc.accounts.set(bondingCurveAddress(m), { owner: PUMP_PROGRAMS.pump, data: curve({ complete: true }) });
    await expect(prepareSplitDevBuy({ slug: "dynasty", creator: LAUNCH_WALLET }, ADMIN)).rejects.toThrow(/graduated/);
  });

  it("the split-create API requires acknowledgeGapRisk: true", async () => {
    await signInAs("ADMIN");
    const body = { slug: "dynasty", creator: LAUNCH_WALLET, mint: mint(), uri: URI("dynasty") };
    expect((await splitRoute(send("POST", "/api/admin/demolition-fund/launch/prepare-split", body))).status).toBe(400);
    expect((await splitRoute(send("POST", "/api/admin/demolition-fund/launch/prepare-split", { ...body, acknowledgeGapRisk: false }))).status).toBe(400);
    expect((await splitRoute(send("POST", "/api/admin/demolition-fund/launch/prepare-split", { ...body, acknowledgeGapRisk: true }))).status).toBe(200);
  });
});
