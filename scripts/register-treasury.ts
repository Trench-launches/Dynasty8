/**
 * Registers a Squads vault as a Demolition Fund treasury wallet, with the same on-chain checks
 * as PUT /api/admin/demolition-fund/wallets (vault derivation, multisig exists, threshold >= 2,
 * members can initiate / vote / execute). Writes only to the database in DATABASE_URL.
 * Accepts addresses only; never a key. Signs and sends nothing.
 *
 *   npm run fund:register -- --role FUND --multisig <multisig> --vault-index 0 --label "Demolition Fund"
 *   npm run fund:register -- --role FUND --multisig <multisig> --vault-index 0 --check   (verify, write nothing)
 */
import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      role: { type: "string" },
      multisig: { type: "string" },
      "vault-index": { type: "string", default: "0" },
      label: { type: "string" },
      check: { type: "boolean", default: false },
    },
  });
  const role = values.role as "FUND" | "ECOSYSTEM" | "OPERATIONS";
  if (!["FUND", "ECOSYSTEM", "OPERATIONS"].includes(role)) throw new Error("--role must be FUND, ECOSYSTEM or OPERATIONS");
  if (!values.multisig) throw new Error("--multisig is required");
  const vaultIndex = Number(values["vault-index"]);
  if (!Number.isInteger(vaultIndex) || vaultIndex < 0 || vaultIndex > 255) throw new Error("--vault-index must be 0-255");

  const { vaultAddress, assessMultisig } = await import("../src/server/demolition/squads");
  const { getDemolitionDeps } = await import("../src/server/demolition/deps");
  const address = vaultAddress(values.multisig, vaultIndex);
  const info = await getDemolitionDeps().squads.readMultisig(values.multisig);
  if (!info) throw new Error("No Squads v4 multisig at that address");
  const assessment = assessMultisig(info);
  console.log(JSON.stringify({ role, multisig: values.multisig, vaultIndex, vault: address, threshold: info.threshold, members: info.members.length, timeLockSeconds: info.timeLockSeconds, assessment }, null, 2));
  if (values.check) return;

  const { setWallet } = await import("../src/server/demolition/fund");
  const label = values.label ?? `${role[0]}${role.slice(1).toLowerCase()} (Squads vault ${vaultIndex})`;
  const saved = await setWallet(role, { address, label, isMultisig: true, multisigAddress: values.multisig, vaultIndex }, { id: null, label: "cli:register-treasury" });
  console.log(`Registered ${role} = ${saved.address} (multisig ${saved.multisigAddress}, vault ${saved.vaultIndex}, ${saved.multisigThreshold} of ${saved.multisigMembers})`);
  for (const w of saved.warnings) console.log(`warning: ${w}`);
  const { prisma } = await import("../src/server/db");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
