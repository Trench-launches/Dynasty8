import "server-only";
import { AddressLookupTableProgram, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import dynastyConfig from "../../../config/launch/dynasty.mainnet.json";
import propertiesConfig from "../../../config/launch/properties.mainnet.json";
import releasePlan from "../../../config/launch/release-plan.json";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { recordAudit, type Actor } from "@/server/services/audit";
import { expectedShareholdersFor } from "./fee-sharing";
import { decodeBondingCurve, getPumpSetupRpc } from "./fee-sharing-setup";
import {
  bondingCurveAddress,
  buildCreateOnlyInstructions,
  buildDevBuyOnlyInstructions,
  compileInstructions,
  compileLaunch,
  decodeCurveReserves,
  decodePumpGlobal,
  tokensOutAtReserves,
  expectedTokensOut,
  freshCurveFeeBps,
  pumpFeeConfigAddress,
  pumpGlobalAddress,
  staticLaunchAccounts,
  validateCoinArgs,
  type DevBuy,
} from "./launch-builder";
import { verifyPinnedMetadata } from "./launch-metadata";
import { decodeSharingConfig, PUMP_PROGRAMS, sharingConfigAddress } from "./pump-fees";
import { MAX_TX_BYTES } from "./squads";

/**
 * Launch preparation for Dynasty 8 coins (owner-run; nothing is launched, signed or sent here):
 *   - listLaunchCoins:      committed launch configs, registration state and release gate
 *   - prepareLookupTable:   unsigned transactions creating + filling the project lookup table
 *   - prepareAtomicLaunch:  unsigned, simulated transaction:
 *       create_v2 -> create_fee_sharing_config -> update_fee_shares_v2 (locked) -> 0.01 SOL buy
 *     signed by the dedicated launch wallet and a mint keypair generated in the owner's browser
 *     (its secret never reaches the server).
 * Name, symbol, metadata, shareholders and dev buy come from the committed config, the release plan
 * and the registered treasury; never from the request. Property coins use 60/25/15; $DYNASTY uses
 * 100% FUND (Option C).
 */
type LaunchCoin = (typeof propertiesConfig.coins)[number] | typeof dynastyConfig.coin;
export const LAUNCH_COINS: LaunchCoin[] = [dynastyConfig.coin, ...propertiesConfig.coins];

export interface ReleasePlan {
  launchWallet: string | null;
  lookupTable: string | null;
  devBuyLamports: string;
  slippageBps: number;
  priorityMicroLamports: number;
  approvedProperties: string[];
}
let planOverride: ReleasePlan | null = null;
export function setReleasePlanForTests(p: ReleasePlan | null) {
  planOverride = p;
}
export const getReleasePlan = (): ReleasePlan => planOverride ?? (releasePlan as unknown as ReleasePlan);

/** SOL the launch wallet should hold beyond the dev buy: rent for the new accounts plus fees (simulated about 0.034 SOL). */
export const LAUNCH_SOL_BUFFER_LAMPORTS = 50_000_000n;

export async function listLaunchCoins() {
  const tokens = await prisma.token.findMany({
    select: { ticker: true, isNative: true, mintAddress: true, deploymentStatus: true, property: { select: { slug: true } } },
  });
  const plan = getReleasePlan();
  return LAUNCH_COINS.map((c) => {
    const t = c.kind === "NATIVE" ? tokens.find((x) => x.isNative) : tokens.find((x) => x.property?.slug === c.slug);
    return {
      slug: c.slug,
      kind: c.kind,
      name: c.name,
      symbol: c.symbol,
      image: c.image,
      website: c.website,
      status: c.status,
      pending: c.pending,
      policy: c.feeSharing.policy,
      approved: c.kind === "NATIVE" || plan.approvedProperties.includes(c.slug),
      registered: { mint: t?.mintAddress ?? null, deploymentStatus: t?.deploymentStatus ?? null },
    };
  });
}

function requireLaunchWallet(wallet: string) {
  const plan = getReleasePlan();
  if (!plan.launchWallet) throw new ApiError(409, "CONFLICT", "No launch wallet is set in config/launch/release-plan.json; launches are refused until the owner sets it");
  if (plan.launchWallet !== wallet) throw new ApiError(403, "FORBIDDEN", "This wallet is not the approved launch wallet");
}

/**
 * The project lookup table, owned by the launch wallet: every account that is identical for all
 * launches plus the launch wallet's own WSOL account and Pump volume accumulator. Returned as one or
 * more unsigned transactions (create + extend, then further extends) to sign in order. It moves no
 * funds; it can be frozen afterwards with Solana tooling.
 */
export async function prepareLookupTable(authority: string, actor: Actor) {
  requireLaunchWallet(authority);
  const expected = await expectedShareholdersFor("PROPERTY");
  if (!expected || expected.holders.length !== 3) throw new ApiError(422, "UNPROCESSABLE", "Register the FUND, ECOSYSTEM and OPERATIONS treasury wallets first");
  const rpc = getPumpSetupRpc();
  let slot: number;
  let blockhash: string;
  let globalAcct;
  try {
    [slot, blockhash, globalAcct] = await Promise.all([rpc.getSlot(), rpc.getLatestBlockhash(), rpc.getAccount(pumpGlobalAddress())]);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Solana; try again later");
  }
  const g = globalAcct ? decodePumpGlobal(globalAcct.data) : null;
  if (!g) throw new ApiError(503, "INTERNAL", "Could not read Pump's global account");
  const addresses = staticLaunchAccounts(expected.holders, { buybackFeeRecipient: g.buybackFeeRecipients[0]!, launchWallet: authority }).map((a) => new PublicKey(a));
  const auth = new PublicKey(authority);
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: auth, payer: auth, recentSlot: slot - 1 });
  const compile = (ixs: TransactionInstruction[]) => new VersionedTransaction(new TransactionMessage({ payerKey: auth, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const fits = (ixs: TransactionInstruction[]) => {
    try {
      return compile(ixs).serialize().length <= MAX_TX_BYTES;
    } catch {
      return false;
    }
  };
  const extend = (chunk: PublicKey[]) => AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: auth, payer: auth, addresses: chunk });
  const txs: VersionedTransaction[] = [];
  let rest = addresses;
  let first = true;
  while (rest.length) {
    let n = rest.length;
    while (n > 0 && !fits([...(first ? [create] : []), extend(rest.slice(0, n))])) n--;
    if (n === 0) throw new ApiError(422, "UNPROCESSABLE", "Lookup table transaction would not fit");
    txs.push(compile([...(first ? [create] : []), extend(rest.slice(0, n))]));
    rest = rest.slice(n);
    first = false;
  }
  await recordAudit(prisma, actor, "launch.lookup_table_prepared", "Fund", null, null, { authority, table: table.toBase58(), addresses: addresses.length, transactions: txs.length });
  return {
    lookupTable: table.toBase58(),
    addresses: addresses.map((s) => s.toBase58()),
    transactions: txs.map((t) => ({ transactionBase64: Buffer.from(t.serialize()).toString("base64"), transactionBytes: t.serialize().length })),
  };
}

/**
 * Release order (owner decision): $DYNASTY first; then ONE approved property coin; then verify its
 * fee-sharing config and run one controlled buyback-and-burn; only then further approved properties,
 * one at a time. Approval = the slug is listed in release-plan.json `approvedProperties`.
 */
async function assertReleaseOrder(coin: LaunchCoin) {
  if (coin.kind === "NATIVE") return;
  const plan = getReleasePlan();
  const native = await prisma.token.findFirst({ where: { isNative: true }, select: { mintAddress: true } });
  if (!native?.mintAddress) throw new ApiError(409, "CONFLICT", "Launch $DYNASTY first (release order)");
  if (!plan.approvedProperties.includes(coin.slug)) throw new ApiError(409, "CONFLICT", `${coin.symbol} is not approved for launch in config/launch/release-plan.json`);
  const launchedProperties = await prisma.token.count({ where: { isNative: false, mintAddress: { not: null } } });
  if (launchedProperties === 0) return; // the first property coin
  const launched = await prisma.token.findMany({ where: { mintAddress: { not: null } }, select: { id: true, ticker: true } });
  const checks = await prisma.feeSharingCheck.findMany({ where: { tokenId: { in: launched.map((t) => t.id) } } });
  const unverified = launched.filter((t) => !checks.find((c) => c.tokenId === t.id && c.matches));
  if (unverified.length) throw new ApiError(409, "CONFLICT", `Verify the fee-sharing config of ${unverified.map((t) => "$" + t.ticker).join(", ")} before launching another property coin`);
  const burned = await prisma.buybackRequest.count({ where: { status: "BURNED" } });
  if (!burned) throw new ApiError(409, "CONFLICT", "Complete one controlled buyback-and-burn before launching another property coin");
}

export interface PreparedLaunch {
  slug: string;
  name: string;
  symbol: string;
  policy: string;
  uri: string;
  metadata: { metadataSha256: string; imageUrl: string; imageSha256: string };
  mint: string;
  creator: string;
  sharingConfig: string;
  shareholders: { address: string; shareBps: number }[];
  lookupTable: string;
  devBuy: { lamports: string; expectedTokens: string; minTokensOut: string; slippageBps: number; buybackFeeRecipient: string };
  priorityMicroLamports: number | null;
  launchWalletBalanceLamports: number;
  /** Unsigned v0 transaction. Signers: the mint keypair (in the owner's browser), then the creator. */
  transactionBase64: string;
  transactionBytes: number;
  simulation: { ok: true; unitsConsumed: number | null };
}

/**
 * Every check that must pass before ANY launch transaction is built (atomic or fallback step 1):
 * coin config, approved launch wallet, owner decisions, Pump argument limits, fresh mint, release
 * order, unlaunched listing, registered treasury = config shareholders, verified pinned metadata.
 */
async function launchPreflight(p: { slug: string; creator: string; mint: string; uri: string }) {
  const coin = LAUNCH_COINS.find((c) => c.slug === p.slug);
  if (!coin) throw new ApiError(404, "NOT_FOUND", "No launch config for that coin");
  requireLaunchWallet(p.creator);
  if (coin.status !== "READY_FOR_OWNER_REVIEW") throw new ApiError(409, "CONFLICT", `${coin.symbol} is waiting on an owner decision: ${coin.pending[0] ?? "see the launch config"}`);
  const argIssues = validateCoinArgs({ name: coin.name, symbol: coin.symbol, uri: p.uri });
  if (argIssues.length) throw new ApiError(422, "UNPROCESSABLE", argIssues.join("; "));
  if (p.mint === p.creator) throw new ApiError(422, "UNPROCESSABLE", "The mint must be a fresh keypair, not the creator wallet");
  await assertReleaseOrder(coin);
  const token =
    coin.kind === "NATIVE"
      ? await prisma.token.findFirst({ where: { isNative: true } })
      : await prisma.token.findFirst({ where: { property: { slug: coin.slug } } });
  if (!token) throw new ApiError(422, "UNPROCESSABLE", "The coin's listing does not exist in the database");
  if (token.mintAddress) throw new ApiError(409, "CONFLICT", `${coin.symbol} already has a registered mint (${token.mintAddress})`);
  const expected = await expectedShareholdersFor(coin.kind === "NATIVE" ? "NATIVE" : "PROPERTY");
  if (!expected || (coin.kind === "PROPERTY" && expected.mode !== "ON_CHAIN_SPLIT")) throw new ApiError(422, "UNPROCESSABLE", "Register the three treasury vaults (ON_CHAIN_SPLIT) first");
  const configured = coin.feeSharing.shareholders.map((h) => `${h.address}:${h.shareBps}`).join(",");
  const registered = expected.holders.map((h) => `${h.address}:${h.shareBps}`).join(",");
  if (configured !== registered) throw new ApiError(409, "CONFLICT", "The launch config's shareholders differ from the registered treasury; regenerate the launch configs");
  const verified = await verifyPinnedMetadata(coin, p.uri);
  return { coin, token, expected, verified };
}

/** What the fallback cannot promise, shown to the owner and returned with every fallback step. */
export const FALLBACK_GAP_RISK =
  "Fallback (separate transactions): between step 1 (create) and step 2 (fee-sharing lock) anyone can trade the new coin. Creator fees from those trades go to the launch wallet's own creator vault, NOT the treasury, and are not booked as fund revenue; step 2 sweeps them there before locking the split. Snipers may also buy before the 0.01 SOL dev buy (step 3), which then gets fewer tokens or fails its 3% slippage floor and must be re-prepared. Fee routing to the treasury is guaranteed only from step 2 onward.";

export async function prepareAtomicLaunch(p: { slug: string; creator: string; mint: string; uri: string; lookupTable: string }, actor: Actor): Promise<PreparedLaunch> {
  const { coin, token, expected, verified } = await launchPreflight(p);

  const rpc = getPumpSetupRpc();
  let mintAcct, alt, blockhash, globalAcct, feeAcct, balance;
  try {
    [mintAcct, alt, blockhash, globalAcct, feeAcct, balance] = await Promise.all([
      rpc.getAccount(p.mint),
      rpc.getLookupTable(p.lookupTable),
      rpc.getLatestBlockhash(),
      rpc.getAccount(pumpGlobalAddress()),
      rpc.getAccount(pumpFeeConfigAddress()),
      rpc.getBalance(p.creator),
    ]);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Solana; try again later");
  }
  if (mintAcct) throw new ApiError(409, "CONFLICT", "That mint address already exists on-chain; generate a new keypair");
  if (!alt) throw new ApiError(422, "UNPROCESSABLE", "Lookup table not found or not active (it becomes usable one slot after it is extended)");
  const g = globalAcct ? decodePumpGlobal(globalAcct.data) : null;
  const feeBps = feeAcct ? freshCurveFeeBps(feeAcct.data) : null;
  if (!g || feeBps === null) throw new ApiError(503, "INTERNAL", "Could not read Pump's global or fee configuration");

  const plan = getReleasePlan();
  const devBuyLamports = BigInt(coin.devBuyLamports);
  if (devBuyLamports !== BigInt(plan.devBuyLamports)) throw new ApiError(409, "CONFLICT", "The coin's dev buy differs from the release plan; regenerate the launch configs");
  const expectedTokens = expectedTokensOut(devBuyLamports, g, feeBps);
  const devBuy: DevBuy = { lamports: devBuyLamports, minTokensOut: (expectedTokens * BigInt(10_000 - plan.slippageBps)) / 10_000n, buybackFeeRecipient: g.buybackFeeRecipients[0]! };
  if (BigInt(balance) < devBuyLamports + LAUNCH_SOL_BUFFER_LAMPORTS) {
    throw new ApiError(422, "UNPROCESSABLE", `The launch wallet holds ${balance} lamports; it needs at least ${devBuyLamports + LAUNCH_SOL_BUFFER_LAMPORTS} (0.01 SOL buy + about 0.05 SOL for rent and fees)`);
  }

  const build = (priority?: number) =>
    compileLaunch({ name: coin.name, symbol: coin.symbol, uri: p.uri, mint: p.mint, creator: p.creator, holders: expected.holders, blockhash, lookupTables: [alt], devBuy, priorityMicroLamports: priority });
  const size = (tx: VersionedTransaction) => {
    try {
      return tx.serialize().length;
    } catch {
      return Infinity;
    }
  };
  let priority: number | null = plan.priorityMicroLamports || null;
  let tx = build(priority ?? undefined);
  if (size(tx) > MAX_TX_BYTES && priority) {
    priority = null; // the priority-fee instruction is optional; drop it before giving up
    tx = build();
  }
  const bytes = size(tx);
  if (bytes > MAX_TX_BYTES) throw new ApiError(422, "UNPROCESSABLE", `The launch is ${Number.isFinite(bytes) ? bytes : "over 1232"} bytes with this lookup table; use the project lookup table and a shorter (CIDv0) metadata URL`);
  let sim;
  try {
    sim = await rpc.simulate(tx);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not simulate on Solana; try again later");
  }
  await recordAudit(prisma, actor, "launch.prepared", "Token", token.id, null, { slug: coin.slug, policy: coin.feeSharing.policy, mint: p.mint, creator: p.creator, lookupTable: p.lookupTable, metadataSha256: verified.metadataSha256, devBuyLamports: coin.devBuyLamports, simulationOk: sim.err == null });
  if (sim.err != null) {
    throw new ApiError(422, "UNPROCESSABLE", `Simulation failed: ${JSON.stringify(sim.err)} ${sim.logs.filter((l) => /Error|failed/.test(l)).slice(-2).join(" | ")}`.slice(0, 500));
  }
  return {
    slug: coin.slug,
    name: coin.name,
    symbol: coin.symbol,
    policy: coin.feeSharing.policy,
    uri: p.uri,
    metadata: { metadataSha256: verified.metadataSha256, imageUrl: verified.imageUrl, imageSha256: verified.imageSha256 },
    mint: p.mint,
    creator: p.creator,
    sharingConfig: sharingConfigAddress(p.mint),
    shareholders: expected.holders,
    lookupTable: p.lookupTable,
    devBuy: { lamports: devBuy.lamports.toString(), expectedTokens: expectedTokens.toString(), minTokensOut: devBuy.minTokensOut.toString(), slippageBps: plan.slippageBps, buybackFeeRecipient: devBuy.buybackFeeRecipient },
    priorityMicroLamports: priority,
    launchWalletBalanceLamports: balance,
    transactionBase64: Buffer.from(tx.serialize()).toString("base64"),
    transactionBytes: bytes,
    simulation: { ok: true, unitsConsumed: sim.unitsConsumed ?? null },
  };
}

// ── Fallback: separate transactions ───────────────────────────────────────────────────────────
//
// Use only when the atomic launch cannot be used (e.g. it does not fit with the available lookup
// table). Same gates as the atomic path. Sequence, each step built from LIVE on-chain state:
//   1. prepareSplitCreate   create_v2 only                (launch wallet + browser mint)
//      -> register the mint (POST /api/admin/properties/{slug}/token or ecosystem/token)
//   2. prepareFeeSharingSetup (fee-sharing-setup.ts)      sweep if needed, create config, lock shares
//   3. prepareSplitDevBuy   0.01 SOL buy, refused until step 2 is verified locked on-chain
// See FALLBACK_GAP_RISK: fees from trades before step 2 do not reach the treasury.

export async function prepareSplitCreate(p: { slug: string; creator: string; mint: string; uri: string; acknowledgeGapRisk: boolean }, actor: Actor) {
  if (!p.acknowledgeGapRisk) throw new ApiError(422, "UNPROCESSABLE", `Acknowledge the fallback risk first. ${FALLBACK_GAP_RISK}`);
  const { coin, token, verified } = await launchPreflight(p);
  const rpc = getPumpSetupRpc();
  let mintAcct, blockhash, balance;
  try {
    [mintAcct, blockhash, balance] = await Promise.all([rpc.getAccount(p.mint), rpc.getLatestBlockhash(), rpc.getBalance(p.creator)]);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Solana; try again later");
  }
  if (mintAcct) throw new ApiError(409, "CONFLICT", "That mint address already exists on-chain; generate a new keypair");
  const devBuyLamports = BigInt(coin.devBuyLamports);
  if (BigInt(balance) < devBuyLamports + LAUNCH_SOL_BUFFER_LAMPORTS) {
    throw new ApiError(422, "UNPROCESSABLE", `The launch wallet holds ${balance} lamports; it needs at least ${devBuyLamports + LAUNCH_SOL_BUFFER_LAMPORTS} for all three steps`);
  }
  const plan = getReleasePlan();
  const tx = compileInstructions(p.creator, blockhash, buildCreateOnlyInstructions({ name: coin.name, symbol: coin.symbol, uri: p.uri, mint: p.mint, creator: p.creator, priorityMicroLamports: plan.priorityMicroLamports || undefined }));
  const bytes = tx.serialize();
  if (bytes.length > MAX_TX_BYTES) throw new ApiError(422, "UNPROCESSABLE", `Create transaction is ${bytes.length} bytes`);
  let sim;
  try {
    sim = await rpc.simulate(tx);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not simulate on Solana; try again later");
  }
  await recordAudit(prisma, actor, "launch.split_create_prepared", "Token", token.id, null, { slug: coin.slug, mint: p.mint, creator: p.creator, metadataSha256: verified.metadataSha256, simulationOk: sim.err == null, gapRiskAcknowledged: true });
  if (sim.err != null) throw new ApiError(422, "UNPROCESSABLE", `Simulation failed: ${JSON.stringify(sim.err)}`.slice(0, 500));
  return {
    step: 1 as const,
    slug: coin.slug,
    symbol: coin.symbol,
    mint: p.mint,
    uri: p.uri,
    risk: FALLBACK_GAP_RISK,
    next: ["Register the mint", "Step 2: lock fee sharing (POST /api/admin/demolition-fund/fee-sharing/setup) immediately", "Step 3: dev buy (POST /api/admin/demolition-fund/launch/dev-buy)"],
    transactionBase64: Buffer.from(bytes).toString("base64"),
    transactionBytes: bytes.length,
    simulation: { ok: true as const, unitsConsumed: sim.unitsConsumed ?? null },
  };
}

/**
 * Step 3 of the fallback (and usable after any launch): the 0.01 SOL buy, priced from the LIVE
 * curve. Refused until the coin's fee sharing is locked on-chain with exactly the expected
 * shareholders, so the buy's own creator fee goes to the treasury.
 */
export async function prepareSplitDevBuy(p: { slug: string; creator: string }, actor: Actor) {
  const coin = LAUNCH_COINS.find((c) => c.slug === p.slug);
  if (!coin) throw new ApiError(404, "NOT_FOUND", "No launch config for that coin");
  requireLaunchWallet(p.creator);
  const token =
    coin.kind === "NATIVE"
      ? await prisma.token.findFirst({ where: { isNative: true } })
      : await prisma.token.findFirst({ where: { property: { slug: coin.slug } } });
  if (!token?.mintAddress) throw new ApiError(409, "CONFLICT", `Register ${coin.symbol}'s mint first (step 1)`);
  const mint = token.mintAddress;
  const expected = await expectedShareholdersFor(coin.kind === "NATIVE" ? "NATIVE" : "PROPERTY");
  if (!expected) throw new ApiError(422, "UNPROCESSABLE", "Register the treasury vaults first");
  const rpc = getPumpSetupRpc();
  let scAcct, curveAcct, globalAcct, feeAcct, blockhash, balance;
  try {
    [scAcct, curveAcct, globalAcct, feeAcct, blockhash, balance] = await Promise.all([
      rpc.getAccount(sharingConfigAddress(mint)),
      rpc.getAccount(bondingCurveAddress(mint)),
      rpc.getAccount(pumpGlobalAddress()),
      rpc.getAccount(pumpFeeConfigAddress()),
      rpc.getLatestBlockhash(),
      rpc.getBalance(p.creator),
    ]);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Solana; try again later");
  }
  const sc = scAcct && scAcct.owner === PUMP_PROGRAMS.fees ? decodeSharingConfig(scAcct.data) : null;
  const locked =
    !!sc && sc.adminRevoked && sc.status === "ACTIVE" && sc.shareholders.map((h) => `${h.address}:${h.shareBps}`).join(",") === expected.holders.map((h) => `${h.address}:${h.shareBps}`).join(",");
  if (!locked) throw new ApiError(409, "CONFLICT", "Fee sharing is not locked to the treasury on-chain yet; complete step 2 before the dev buy");
  const curve = curveAcct && curveAcct.owner === PUMP_PROGRAMS.pump ? decodeBondingCurve(curveAcct.data) : null;
  const reserves = curveAcct ? decodeCurveReserves(curveAcct.data) : null;
  if (!curve || !reserves) throw new ApiError(422, "UNPROCESSABLE", "No Pump bonding curve for this mint");
  if (curve.complete) throw new ApiError(409, "CONFLICT", "The coin has already graduated; no dev buy on the curve");
  const g = globalAcct ? decodePumpGlobal(globalAcct.data) : null;
  const feeBps = feeAcct ? freshCurveFeeBps(feeAcct.data) : null;
  if (!g || feeBps === null) throw new ApiError(503, "INTERNAL", "Could not read Pump's global or fee configuration");
  const plan = getReleasePlan();
  const lamports = BigInt(coin.devBuyLamports);
  if (BigInt(balance) < lamports + 5_000_000n) throw new ApiError(422, "UNPROCESSABLE", `The launch wallet holds ${balance} lamports; it needs at least ${lamports + 5_000_000n}`);
  const expectedTokens = tokensOutAtReserves(lamports, reserves, feeBps);
  const devBuy: DevBuy = { lamports, minTokensOut: (expectedTokens * BigInt(10_000 - plan.slippageBps)) / 10_000n, buybackFeeRecipient: g.buybackFeeRecipients[0]! };
  const tx = compileInstructions(p.creator, blockhash, buildDevBuyOnlyInstructions({ mint, creator: p.creator, priorityMicroLamports: plan.priorityMicroLamports || undefined, ...devBuy }));
  const bytes = tx.serialize();
  let sim;
  try {
    sim = await rpc.simulate(tx);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not simulate on Solana; try again later");
  }
  await recordAudit(prisma, actor, "launch.dev_buy_prepared", "Token", token.id, null, { slug: coin.slug, mint, lamports: coin.devBuyLamports, minTokensOut: devBuy.minTokensOut, simulationOk: sim.err == null });
  if (sim.err != null) throw new ApiError(422, "UNPROCESSABLE", `Simulation failed: ${JSON.stringify(sim.err)}`.slice(0, 500));
  return {
    step: 3 as const,
    slug: coin.slug,
    symbol: coin.symbol,
    mint,
    devBuy: { lamports: lamports.toString(), expectedTokens: expectedTokens.toString(), minTokensOut: devBuy.minTokensOut.toString(), slippageBps: plan.slippageBps },
    transactionBase64: Buffer.from(bytes).toString("base64"),
    transactionBytes: bytes.length,
    simulation: { ok: true as const, unitsConsumed: sim.unitsConsumed ?? null },
  };
}
