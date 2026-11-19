/**
 * $DYNASTY buyback-and-burn rehearsal against the REAL Dynasty multisig, read-only.
 * $DYNASTY does not exist yet, so a live Pump coin stands in for it. Nothing is signed or sent.
 *
 *   1. Jupiter Swap V2 /build: SOL -> stand-in coin, taker = fund vault (vault 0), checked by
 *      the same pre-signing policy the backend uses.
 *   2. Unsigned Squads proposal (vault transaction + proposal) wrapping that swap, creator = a
 *      real member, at the multisig's real next transaction index.
 *   3. Unsigned Squads proposal wrapping BurnChecked of the stand-in coin from the vault.
 *   4. Unsigned approve transactions for the other two members.
 *   5. simulateTransaction (sigVerify off) of each proposal creation, so the Squads program itself
 *      checks the accounts, index and permissions. Needs the creator member to hold a little SOL;
 *      if it holds none, the simulation reports that and everything else still runs.
 * Execution cannot be rehearsed on-chain without creating a real proposal (a live transaction);
 * the full lifecycle including execution and settlement runs in tests/integration/dynasty-rehearsal.test.ts.
 *
 *   npx tsx --conditions=react-server scripts/rehearsal/dynasty-buyback-rehearsal.ts [--out docs/launch/rehearsal-report.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";

const STAND_IN = process.env.REHEARSAL_MINT ?? "KMhMBUj1qX2PYEBBUwjWmxA1dYbZvvDLHQZEwwvpump";
const WSOL = "So11111111111111111111111111111111111111112";

async function main() {
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const { createRpcSquadsReader, buildVaultProposal, buildMemberActionTransaction, toInstruction, vaultAddress } = await import("../../src/server/demolition/squads");
  const { assertSwapAllowed, JUPITER_V6_PROGRAM } = await import("../../src/server/demolition/policy");
  const { createJupiterSwapProvider } = await import("../../src/server/demolition/jupiter");
  const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as { multisig: string };
  const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const reader = createRpcSquadsReader(conn);
  const ms = treasury.multisig;
  const info = await reader.readMultisig(ms);
  if (!info) throw new Error("Multisig not found");
  const vault = vaultAddress(ms, 0);
  const [creator, ...others] = info.members.map((m) => m.key);
  const report: Record<string, unknown> = {
    rehearsedAt: new Date().toISOString(),
    note: "Read-only rehearsal: unsigned transactions and simulations only. A live coin stands in for $DYNASTY. Nothing was signed or sent.",
    multisig: ms,
    threshold: info.threshold,
    nextTransactionIndex: (info.transactionIndex + 1n).toString(),
    fundVault: vault,
    standIn: STAND_IN,
  };

  const simulateCreation = async (base64: string) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    const bal = await conn.getBalance(new PublicKey(creator!));
    if (bal < 5_000_000) return { skipped: `creator member ${creator} holds ${bal} lamports; fund it with ~0.01 SOL to simulate proposal creation` };
    const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    return { ok: r.value.err === null, err: r.value.err, unitsConsumed: r.value.unitsConsumed, logs: (r.value.logs ?? []).filter((l) => /Instruction:|failed|Error/.test(l)).slice(-6) };
  };

  // 1-2. Swap
  const jup = createJupiterSwapProvider({ timeoutMs: 20_000, apiKey: process.env.JUPITER_API_KEY });
  const budget = 50_000_000n; // 0.05 SOL rehearsal size
  try {
    const b = await jup.build({ inputMint: WSOL, outputMint: STAND_IN, amount: budget, taker: vault, slippageBps: 300 });
    let policy = "pass";
    try {
      assertSwapAllowed(b, { fundWallet: vault, targetMint: STAND_IN, budgetLamports: budget, maxPriceImpactBps: 2000, slippageBps: 300, swapPrograms: [JUPITER_V6_PROGRAM] });
    } catch (e) {
      policy = `violation: ${(e as Error).message}`;
    }
    const ixs = [...b.instructions.setup, b.instructions.swap, ...(b.instructions.cleanup ? [b.instructions.cleanup] : []), ...b.instructions.other].map(toInstruction);
    const draft = await buildVaultProposal(reader, { multisig: ms, vaultIndex: 0, creator: creator!, instructions: ixs, lookupTableAddresses: Object.keys(b.lookupTables), memo: "dynasty8 rehearsal swap (not sent)" });
    report.swap = {
      budgetLamports: budget.toString(),
      quotedOut: b.outAmount.toString(),
      minOut: b.minOut.toString(),
      priceImpactBps: b.priceImpactBps,
      route: b.routeLabels,
      policy,
      proposal: { transactionIndex: draft.transactionIndex.toString(), proposalPda: draft.proposalPda, bytes: draft.transactionBytes, innerInstructions: draft.expectedMessage.instructions.length, creator },
      creationSimulation: await simulateCreation(draft.transactionBase64),
    };
  } catch (e) {
    report.swap = { error: e instanceof Error ? e.message : String(e) };
  }

  // 3. Burn
  try {
    const mintPk = new PublicKey(STAND_IN);
    const mintAcct = await conn.getAccountInfo(mintPk);
    const tokenProgram = mintAcct!.owner;
    const mint = await getMint(conn, mintPk, "confirmed", tokenProgram);
    const vaultAta = getAssociatedTokenAddressSync(mintPk, new PublicKey(vault), true, tokenProgram);
    const burn = createBurnCheckedInstruction(vaultAta, mintPk, new PublicKey(vault), 1_000_000n, mint.decimals, [], tokenProgram);
    const draft = await buildVaultProposal(reader, { multisig: ms, vaultIndex: 0, creator: creator!, instructions: [burn], lookupTableAddresses: [], memo: "dynasty8 rehearsal burn (not sent)" });
    report.burn = { tokenProgram: tokenProgram.toBase58(), decimals: mint.decimals, vaultTokenAccount: vaultAta.toBase58(), proposal: { transactionIndex: draft.transactionIndex.toString(), bytes: draft.transactionBytes }, creationSimulation: await simulateCreation(draft.transactionBase64) };
  } catch (e) {
    report.burn = { error: e instanceof Error ? e.message : String(e) };
  }

  // 4. Approvals by the two other members (unsigned; approve needs no on-chain lookups to build).
  report.approvals = [];
  for (const m of others) {
    const a = await buildMemberActionTransaction(reader, { multisig: ms, transactionIndex: info.transactionIndex + 1n, member: m, action: "approve", memo: "dynasty8 rehearsal" });
    const tx = VersionedTransaction.deserialize(Buffer.from(a.transactionBase64, "base64"));
    (report.approvals as unknown[]).push({ member: m, bytes: a.transactionBytes, signers: tx.message.header.numRequiredSignatures, feePayer: tx.message.staticAccountKeys[0]!.toBase58() });
  }

  const body = JSON.stringify(report, null, 2) + "\n";
  if (out) writeFileSync(out, body);
  console.log(body);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
