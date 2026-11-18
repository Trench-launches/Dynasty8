/**
 * Read-only external verification against live Solana infrastructure (no keys, no signing,
 * nothing sent). Evidence for docs/DEMOLITION-FUND.md.
 *
 *   npx tsx --conditions=react-server scripts/verify/external-checks.ts [pump|jupiter|squads|all]
 *
 * pump    finds real Pump fee-sharing configs and distribute transactions on mainnet and runs
 *         this repo's decoders and receipt checks against them
 * jupiter makes a real Jupiter Swap V2 /build request (unsigned) and checks the returned
 *         instructions against the buyback policy allowlist
 * squads  decodes real Squads v4 multisig accounts with this repo's multisig reader
 */
import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import { createRpcChainReader, lamportDelta } from "../../src/server/demolition/chain";
import { createJupiterSwapProvider } from "../../src/server/demolition/jupiter";
import { JUPITER_V6_PROGRAM } from "../../src/server/demolition/policy";
import { decodeSharingConfig, distributeEventsIn, PUMP_PROGRAMS, sharingConfigAddress, SHARING_CONFIG_DISCRIMINATOR } from "../../src/server/demolition/pump-fees";
import { PROGRAMS } from "../../src/server/solana/address";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: Record<string, unknown> = { rpc: new URL(RPC).host, at: new Date().toISOString() };

async function pump() {
  const conn = new Connection(RPC, "finalized");
  const reader = createRpcChainReader(RPC);
  const fees = await conn.getAccountInfo(new PublicKey(PUMP_PROGRAMS.fees));
  const res: Record<string, unknown> = { feesProgramExecutable: fees?.executable ?? false };

  // Real SharingConfig addresses sampled from getProgramAccounts (see sample-sharing-configs.json).
  const { readFileSync } = await import("node:fs");
  const sample = JSON.parse(readFileSync(new URL("./sample-sharing-configs.json", import.meta.url), "utf8")) as { addresses: string[] };
  const configs = new Set<string>(sample.addresses);
  // Keep only real SharingConfig accounts (owner = fees program, discriminator matches).
  const real: { address: string; mint: string; shareholders: number; adminRevoked: boolean; status: string; pdaMatches: boolean }[] = [];
  const list = [...configs];
  for (let i = 0; i < list.length; i += 100) {
    const infos = await conn.getMultipleAccountsInfo(list.slice(i, i + 100).map((a) => new PublicKey(a)));
    infos.forEach((info, j) => {
      if (!info || info.owner.toBase58() !== PUMP_PROGRAMS.fees) return;
      if (!Buffer.from(info.data.subarray(0, 8)).equals(SHARING_CONFIG_DISCRIMINATOR)) return;
      const c = decodeSharingConfig(Buffer.from(info.data));
      if (!c) return;
      const address = list[i + j]!;
      real.push({ address, mint: c.mint, shareholders: c.shareholders.length, adminRevoked: c.adminRevoked, status: c.status, pdaMatches: sharingConfigAddress(c.mint) === address });
    });
  }
  res.sharingConfigsDecoded = real.length;
  res.sharingConfigSample = real.slice(0, 5);
  res.allPdaMatch = real.every((r) => r.pdaMatches);

  // Look for distribute transactions on those configs and verify them with our parser.
  const verified: unknown[] = [];
  for (const c of real.slice(0, 30)) {
    if (verified.length >= 3) break;
    await sleep(300);
    const cs = await conn.getSignaturesForAddress(new PublicKey(c.address), { limit: 15 }).catch(() => []);
    for (const s of cs) {
      if (s.err || verified.length >= 3) continue;
      await sleep(250);
      const tx = await reader.getTransaction(s.signature).catch(() => null);
      if (!tx) continue;
      const events = distributeEventsIn(tx);
      for (const e of events) {
        const holder = e.shareholders[0];
        if (!holder) continue;
        const share = (e.distributed * BigInt(holder.shareBps)) / 10_000n;
        verified.push({
          signature: s.signature,
          mint: e.mint,
          sharingConfigMatchesPda: e.sharingConfig === sharingConfigAddress(e.mint),
          quoteMint: e.quoteMint,
          shareholders: e.shareholders.length,
          distributed: e.distributed.toString(),
          firstShareholderShare: share.toString(),
          firstShareholderLamportDelta: lamportDelta(tx, holder.address).toString(),
          balanceCoversShare: lamportDelta(tx, holder.address) + (tx.accountKeys[0] === holder.address ? tx.fee : 0n) >= share,
        });
      }
    }
  }
  res.distributeTransactionsVerified = verified;
  out.pump = res;
}

async function jupiter() {
  const provider = createJupiterSwapProvider({ timeoutMs: 15_000, apiKey: process.env.JUPITER_API_KEY });
  // A syntactically valid taker that holds nothing; /build only constructs instructions.
  const taker = "7UX2i7SucgLMQcfZ75s3VXmZZY4YRUyJN9X1RgfMoDUi";
  try {
    const b = await provider.build({ inputMint: PROGRAMS.WRAPPED_SOL, outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: 10_000_000n, taker, slippageBps: 100 });
    const programs = new Set([...b.instructions.computeBudget, ...b.instructions.setup, b.instructions.swap, ...(b.instructions.cleanup ? [b.instructions.cleanup] : []), ...b.instructions.other].map((i) => i.programId));
    out.jupiter = {
      ok: true,
      swapProgramId: b.instructions.swap.programId,
      matchesAllowlistDefault: b.instructions.swap.programId === JUPITER_V6_PROGRAM,
      programsInBuild: [...programs],
      inAmount: b.inAmount.toString(),
      outAmount: b.outAmount.toString(),
      minOut: b.minOut.toString(),
      priceImpactBps: b.priceImpactBps,
      route: b.routeLabels,
      lookupTables: Object.keys(b.lookupTables).length,
    };
  } catch (e) {
    out.jupiter = { ok: false, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

async function squads() {
  const { readMultisig, SQUADS_V4_PROGRAM, vaultAddress } = await import("../../src/server/demolition/squads");
  const conn = new Connection(RPC, "finalized");
  const sigs = await conn.getSignaturesForAddress(new PublicKey(SQUADS_V4_PROGRAM), { limit: 40 });
  const seen = new Set<string>();
  const decoded: unknown[] = [];
  for (const s of sigs) {
    if (s.err || decoded.length >= 3) continue;
    await sleep(250);
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "finalized" }).catch(() => null);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    for (let i = 0; i < keys.length && decoded.length < 3; i++) {
      const k = keys.get(i)!.toBase58();
      if (seen.has(k)) continue;
      seen.add(k);
      const m = await readMultisig(conn, k).catch(() => null);
      if (m) decoded.push({ multisig: k, threshold: m.threshold, members: m.members.length, transactionIndex: m.transactionIndex.toString(), vault0: vaultAddress(k, 0) });
    }
  }
  out.squads = { programExecutable: (await conn.getAccountInfo(new PublicKey(SQUADS_V4_PROGRAM)))?.executable ?? false, multisigsDecoded: decoded };
}

/**
 * Builds (does not sign or send) a real buyback proposal: a real Jupiter /build route with
 * a real Squads v4 multisig's vault as taker, wrapped into vault_transaction_create +
 * proposal_create with one of that multisig's real members as creator. Measures size and
 * checks the policy and the message round-trip. Uses a public multisig purely as a fixture.
 */
async function proposal() {
  const { createRpcSquadsReader, buildVaultProposal, assessMultisig, toInstruction, vaultAddress } = await import("../../src/server/demolition/squads");
  const { assertSwapAllowed } = await import("../../src/server/demolition/policy");
  const conn = new Connection(RPC, "finalized");
  const reader = createRpcSquadsReader(conn);
  const ms = process.env.VERIFY_MULTISIG ?? "843JZ1K78MjZ2pgQU7EvPqoFgs6eULi2vtEPvKJafEFM";
  const info = await reader.readMultisig(ms);
  if (!info) return void (out.proposal = { error: "multisig not found" });
  const vault = vaultAddress(ms, 0);
  const creator = info.members.find((m) => m.initiate)!.key;
  const jup = createJupiterSwapProvider({ timeoutMs: 15_000, apiKey: process.env.JUPITER_API_KEY });
  const results: unknown[] = [];
  for (const target of [
    { name: "USDC (deep liquidity)", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    { name: "Pump.fun coin from the sample", mint: "KMhMBUj1qX2PYEBBUwjWmxA1dYbZvvDLHQZEwwvpump" },
  ]) {
    try {
      const b = await jup.build({ inputMint: PROGRAMS.WRAPPED_SOL, outputMint: target.mint, amount: 10_000_000n, taker: vault, slippageBps: 100 });
      let policy = "pass";
      try {
        assertSwapAllowed(b, { fundWallet: vault, targetMint: target.mint, budgetLamports: 10_000_000n, maxPriceImpactBps: 2000, slippageBps: 100, swapPrograms: [JUPITER_V6_PROGRAM] });
      } catch (e) {
        policy = `violation: ${(e as Error).message}`;
      }
      const ixs = [...b.instructions.setup, b.instructions.swap, ...(b.instructions.cleanup ? [b.instructions.cleanup] : []), ...b.instructions.other].map(toInstruction);
      const draft = await buildVaultProposal(reader, { multisig: ms, vaultIndex: 0, creator, instructions: ixs, lookupTableAddresses: Object.keys(b.lookupTables), memo: "dynasty8 verification (not sent)" });
      results.push({ target: target.name, route: b.routeLabels, policy, proposalTxBytes: draft.transactionBytes, transactionIndex: draft.transactionIndex.toString(), innerInstructions: draft.expectedMessage.instructions.length, lookups: draft.expectedMessage.addressTableLookups.length });
    } catch (e) {
      results.push({ target: target.name, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
    }
    await sleep(2500);
  }
  out.proposal = { multisig: ms, threshold: info.threshold, members: info.members.length, assessment: assessMultisig(info), results };
}

const which = process.argv[2] ?? "all";
(async () => {
  if (which === "pump" || which === "all") await pump().catch((e) => (out.pump = { error: String(e) }));
  if (which === "jupiter" || which === "all") await jupiter();
  if (which === "squads" || which === "all") await squads().catch((e) => (out.squads = { error: String(e) }));
  if (which === "proposal" || which === "all") await proposal().catch((e) => (out.proposal = { error: String(e) }));
  console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
})();
void bs58;
