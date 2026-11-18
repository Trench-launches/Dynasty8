/**
 * Registers Squads vaults as Demolition Fund treasury wallets, with the same on-chain checks as
 * PUT /api/admin/demolition-fund/wallets (vault derivation, multisig exists, threshold >= 2,
 * members can initiate / vote / execute). Writes only to the database in DATABASE_URL.
 * Accepts addresses only; never a key. Signs and sends nothing.
 *
 *   npm run fund:register -- --config config/treasury.mainnet.json          # all three roles
 *   npm run fund:register -- --config config/treasury.mainnet.json --check  # verify, write nothing
 *   npm run fund:register -- --role FUND --multisig <multisig> --vault-index 0 [--label "..."]
 *
 * With --config, every listed address must equal the vault derived from the multisig and index,
 * and the shares must match the fund's split (sum 10000); otherwise nothing is written.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

type Role = "FUND" | "ECOSYSTEM" | "OPERATIONS";
interface Entry {
  role: Role;
  vaultIndex: number;
  address?: string;
  shareBps?: number;
  label?: string;
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      role: { type: "string" },
      multisig: { type: "string" },
      "vault-index": { type: "string", default: "0" },
      label: { type: "string" },
      check: { type: "boolean", default: false },
    },
  });

  let multisigAddr: string;
  let entries: Entry[];
  if (values.config) {
    const cfg = JSON.parse(readFileSync(values.config, "utf8")) as { multisig: string; wallets: Entry[] };
    multisigAddr = cfg.multisig;
    entries = cfg.wallets;
    const roles = new Set(entries.map((e) => e.role));
    if (roles.size !== entries.length) throw new Error("Each role may appear once");
    const total = entries.reduce((s, e) => s + (e.shareBps ?? 0), 0);
    if (entries.some((e) => e.shareBps !== undefined) && total !== 10_000) throw new Error(`Shares sum to ${total}, not 10000`);
  } else {
    if (!values.multisig) throw new Error("--multisig (or --config) is required");
    multisigAddr = values.multisig;
    entries = [{ role: values.role as Role, vaultIndex: Number(values["vault-index"]), label: values.label }];
  }
  for (const e of entries) {
    if (!["FUND", "ECOSYSTEM", "OPERATIONS"].includes(e.role)) throw new Error(`Bad role ${e.role}`);
    if (!Number.isInteger(e.vaultIndex) || e.vaultIndex < 0 || e.vaultIndex > 255) throw new Error(`Bad vault index for ${e.role}`);
  }

  const { vaultAddress, assessMultisig } = await import("../src/server/demolition/squads");
  const { getDemolitionDeps } = await import("../src/server/demolition/deps");
  const info = await getDemolitionDeps().squads.readMultisig(multisigAddr);
  if (!info) throw new Error("No Squads v4 multisig at that address");
  const assessment = assessMultisig(info);
  const plan = entries.map((e) => {
    const derived = vaultAddress(multisigAddr, e.vaultIndex);
    if (e.address && e.address !== derived) throw new Error(`${e.role}: ${e.address} is not vault ${e.vaultIndex} of ${multisigAddr} (that is ${derived})`);
    return { ...e, address: derived };
  });
  console.log(
    JSON.stringify(
      { multisig: multisigAddr, threshold: info.threshold, members: info.members.map((m) => m.key), timeLockSeconds: info.timeLockSeconds, assessment, wallets: plan.map(({ role, vaultIndex, address, shareBps }) => ({ role, vaultIndex, address, shareBps })) },
      null,
      2,
    ),
  );
  if (!assessment.ok) throw new Error("The multisig does not meet the treasury policy; nothing registered");
  if (values.check) return;

  if (values.config) {
    // The configured split must match the fund's split, so Pump's shares and the ledger agree.
    const { getFundConfig } = await import("../src/server/demolition/fund");
    const cfg = await getFundConfig();
    const want: Record<Role, number> = { FUND: cfg.buybackBps, ECOSYSTEM: cfg.ecosystemBps, OPERATIONS: cfg.operationsBps };
    for (const e of plan) if (e.shareBps !== undefined && e.shareBps !== want[e.role]) throw new Error(`${e.role} share ${e.shareBps} differs from the fund config ${want[e.role]}`);
  }

  const { setWallet } = await import("../src/server/demolition/fund");
  for (const e of plan) {
    const label = e.label ?? `${e.role[0]}${e.role.slice(1).toLowerCase()} (Squads vault ${e.vaultIndex})`;
    const saved = await setWallet(e.role, { address: e.address, label, isMultisig: true, multisigAddress: multisigAddr, vaultIndex: e.vaultIndex }, { id: null, label: "cli:register-treasury" });
    console.log(`Registered ${e.role} = ${saved.address} (vault ${saved.vaultIndex}, ${saved.multisigThreshold} of ${saved.multisigMembers})`);
  }
  for (const w of assessment.warnings) console.log(`warning: ${w}`);
  const { prisma } = await import("../src/server/db");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
