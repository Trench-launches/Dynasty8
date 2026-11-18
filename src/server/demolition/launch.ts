import "server-only";
import { AddressLookupTableProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import dynastyConfig from "../../../config/launch/dynasty.mainnet.json";
import propertiesConfig from "../../../config/launch/properties.mainnet.json";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/responses";
import { recordAudit, type Actor } from "@/server/services/audit";
import { expectedShareholders } from "./fee-sharing";
import { getPumpSetupRpc } from "./fee-sharing-setup";
import { compileLaunch, staticLaunchAccounts, validateCoinArgs } from "./launch-builder";
import { sharingConfigAddress } from "./pump-fees";
import { MAX_TX_BYTES } from "./squads";

/**
 * Launch preparation for Dynasty 8 coins (owner-run; nothing is launched from here):
 *   - listLaunchCoins:        the committed launch configs with their registration state
 *   - prepareLookupTable:     unsigned tx creating + filling the project's address lookup table
 *   - prepareAtomicLaunch:    unsigned, simulated tx: create_v2 + fee-sharing config + locked
 *                             60/25/15 shares, for the launch wallet to sign together with a mint
 *                             keypair generated in the owner's browser (its secret never reaches
 *                             the server)
 * Name, symbol and shareholders always come from the committed config / registered treasury,
 * never from the request.
 */
type LaunchCoin = (typeof propertiesConfig.coins)[number] | typeof dynastyConfig.coin;
export const LAUNCH_COINS: LaunchCoin[] = [dynastyConfig.coin, ...propertiesConfig.coins];

export async function listLaunchCoins() {
  const tokens = await prisma.token.findMany({
    select: { ticker: true, isNative: true, mintAddress: true, deploymentStatus: true, property: { select: { slug: true } } },
  });
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
      registered: { mint: t?.mintAddress ?? null, deploymentStatus: t?.deploymentStatus ?? null },
    };
  });
}

/**
 * The project lookup table: createLookupTable + extendLookupTable with every account that is the
 * same for all launches (programs, Pump globals, event authorities, Mayhem accounts, WSOL). The
 * treasury vaults are instruction data, not accounts, so they are not in it. Signed once by the
 * launch wallet; it can then be frozen (made immutable) with Solana tooling.
 */
export async function prepareLookupTable(authority: string, actor: Actor) {
  const expected = await expectedShareholders();
  if (!expected || expected.holders.length !== 3) throw new ApiError(422, "UNPROCESSABLE", "Register the FUND, ECOSYSTEM and OPERATIONS treasury wallets first");
  const rpc = getPumpSetupRpc();
  const statics = staticLaunchAccounts(expected.holders).map((a) => new PublicKey(a));
  let slot: number;
  let blockhash: string;
  try {
    slot = await rpc.getSlot();
    blockhash = await rpc.getLatestBlockhash();
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Solana; try again later");
  }
  if (!slot) throw new ApiError(503, "INTERNAL", "Could not read the current slot; try again later");
  const auth = new PublicKey(authority);
  const [create, table] = AddressLookupTableProgram.createLookupTable({ authority: auth, payer: auth, recentSlot: slot - 1 });
  const extend = AddressLookupTableProgram.extendLookupTable({ lookupTable: table, authority: auth, payer: auth, addresses: statics });
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: auth, recentBlockhash: blockhash, instructions: [create, extend] }).compileToV0Message());
  const bytes = tx.serialize();
  if (bytes.length > MAX_TX_BYTES) throw new ApiError(422, "UNPROCESSABLE", `Lookup table transaction is ${bytes.length} bytes`);
  await recordAudit(prisma, actor, "launch.lookup_table_prepared", "Fund", null, null, { authority, table: table.toBase58(), addresses: statics.length });
  return { lookupTable: table.toBase58(), addresses: statics.map((s) => s.toBase58()), transactionBase64: Buffer.from(bytes).toString("base64"), transactionBytes: bytes.length };
}

export interface PreparedLaunch {
  slug: string;
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  creator: string;
  sharingConfig: string;
  shareholders: { address: string; shareBps: number }[];
  lookupTable: string;
  /** Unsigned v0 transaction. Signers: the mint keypair (in the owner's browser), then the creator. */
  transactionBase64: string;
  transactionBytes: number;
  simulation: { ok: true; unitsConsumed: number | null };
}

export async function prepareAtomicLaunch(p: { slug: string; creator: string; mint: string; uri: string; lookupTable: string }, actor: Actor): Promise<PreparedLaunch> {
  const coin = LAUNCH_COINS.find((c) => c.slug === p.slug);
  if (!coin) throw new ApiError(404, "NOT_FOUND", "No launch config for that coin");
  if (coin.status !== "READY_FOR_OWNER_REVIEW") throw new ApiError(409, "CONFLICT", `${coin.symbol} is waiting on an owner decision: ${coin.pending[0] ?? "see the launch config"}`);
  const argIssues = validateCoinArgs({ name: coin.name, symbol: coin.symbol, uri: p.uri });
  if (argIssues.length) throw new ApiError(422, "UNPROCESSABLE", argIssues.join("; "));
  if (p.mint === p.creator) throw new ApiError(422, "UNPROCESSABLE", "The mint must be a fresh keypair, not the creator wallet");

  const token =
    coin.kind === "NATIVE"
      ? await prisma.token.findFirst({ where: { isNative: true } })
      : await prisma.token.findFirst({ where: { property: { slug: coin.slug } } });
  if (!token) throw new ApiError(422, "UNPROCESSABLE", "The coin's listing does not exist in the database");
  if (token.mintAddress) throw new ApiError(409, "CONFLICT", `${coin.symbol} already has a registered mint (${token.mintAddress})`);

  const expected = await expectedShareholders();
  if (!expected || expected.mode !== "ON_CHAIN_SPLIT") throw new ApiError(422, "UNPROCESSABLE", "Register the three treasury vaults (ON_CHAIN_SPLIT) first");
  const configured = coin.feeSharing.shareholders.map((h) => `${h.address}:${h.shareBps}`).join(",");
  const registered = expected.holders.map((h) => `${h.address}:${h.shareBps}`).join(",");
  if (configured !== registered) throw new ApiError(409, "CONFLICT", "The launch config's shareholders differ from the registered treasury; regenerate the launch configs");

  const rpc = getPumpSetupRpc();
  let mintAcct, alt, blockhash;
  try {
    [mintAcct, alt, blockhash] = await Promise.all([rpc.getAccount(p.mint), rpc.getLookupTable(p.lookupTable), rpc.getLatestBlockhash()]);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not read Solana; try again later");
  }
  if (mintAcct) throw new ApiError(409, "CONFLICT", "That mint address already exists on-chain; generate a new keypair");
  if (!alt) throw new ApiError(422, "UNPROCESSABLE", "Lookup table not found or not active (it becomes usable one slot after it is extended)");

  const tx = compileLaunch({ name: coin.name, symbol: coin.symbol, uri: p.uri, mint: p.mint, creator: p.creator, holders: expected.holders, blockhash, lookupTables: [alt] });
  let bytes: Uint8Array;
  try {
    bytes = tx.serialize();
  } catch {
    throw new ApiError(422, "UNPROCESSABLE", "The launch does not fit in one transaction with this lookup table; use the project lookup table");
  }
  if (bytes.length > MAX_TX_BYTES) throw new ApiError(422, "UNPROCESSABLE", `Launch transaction is ${bytes.length} bytes (max ${MAX_TX_BYTES})`);
  let sim;
  try {
    sim = await rpc.simulate(tx);
  } catch {
    throw new ApiError(503, "INTERNAL", "Could not simulate on Solana; try again later");
  }
  await recordAudit(prisma, actor, "launch.prepared", "Token", token.id, null, { slug: coin.slug, mint: p.mint, creator: p.creator, lookupTable: p.lookupTable, simulationOk: sim.err == null });
  if (sim.err != null) {
    throw new ApiError(422, "UNPROCESSABLE", `Simulation failed: ${JSON.stringify(sim.err)} ${sim.logs.filter((l) => /Error|failed/.test(l)).slice(-2).join(" | ")}`.slice(0, 500));
  }
  return {
    slug: coin.slug,
    name: coin.name,
    symbol: coin.symbol,
    uri: p.uri,
    mint: p.mint,
    creator: p.creator,
    sharingConfig: sharingConfigAddress(p.mint),
    shareholders: expected.holders,
    lookupTable: p.lookupTable,
    transactionBase64: Buffer.from(bytes).toString("base64"),
    transactionBytes: bytes.length,
    simulation: { ok: true, unitsConsumed: sim.unitsConsumed ?? null },
  };
}
