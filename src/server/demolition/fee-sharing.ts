import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { logger } from "@/server/logger";
import { recordAudit, SYSTEM_ACTOR } from "@/server/services/audit";
import { getDemolitionDeps } from "./deps";
import { getFundConfig, getWallet } from "./fund";
import { decodeSharingConfig, PUMP_PROGRAMS, sharingConfigAddress } from "./pump-fees";

/**
 * On-chain check of every registered property token's Pump fee-sharing configuration.
 *
 * Pump's fee-sharing config can be edited by its admin (update_fee_shares*,
 * transfer/revoke_fee_sharing_authority) until the admin is revoked, and Pump's protocol
 * admin can reset it (admin_cto_sharing_config). So the expected state is checked
 * continuously, not once:
 *   - the config exists at the canonical PDA and is ACTIVE;
 *   - the admin is revoked (shares locked);
 *   - shareholders are exactly the expected wallets and basis points.
 * Mismatches are surfaced on the dashboard and in the audit log. Receipts are still checked
 * per event, so a changed config can never redirect booked revenue.
 */
export interface ExpectedShareholders {
  mode: "ON_CHAIN_SPLIT" | "FUND_SPLITS";
  holders: { address: string; shareBps: number }[];
}

export async function expectedShareholders(): Promise<ExpectedShareholders | null> {
  const [cfg, fund, eco, ops] = await Promise.all([getFundConfig(), getWallet("FUND"), getWallet("ECOSYSTEM"), getWallet("OPERATIONS")]);
  if (!fund) return null;
  if (cfg.allocationMode === "FUND_SPLITS") return { mode: "FUND_SPLITS", holders: [{ address: fund.address, shareBps: 10_000 }] };
  if (!eco || !ops) return null;
  return {
    mode: "ON_CHAIN_SPLIT",
    holders: [
      { address: fund.address, shareBps: cfg.buybackBps },
      { address: eco.address, shareBps: cfg.ecosystemBps },
      { address: ops.address, shareBps: cfg.operationsBps },
    ].filter((h) => h.shareBps > 0),
  };
}

export function compareShareholders(found: { address: string; shareBps: number }[], expected: { address: string; shareBps: number }[]): string[] {
  const issues: string[] = [];
  const key = (h: { address: string; shareBps: number }) => `${h.address}:${h.shareBps}`;
  const f = new Set(found.map(key));
  const e = new Set(expected.map(key));
  for (const x of expected) if (!f.has(key(x))) issues.push(`missing shareholder ${x.address} at ${x.shareBps} bps`);
  for (const x of found) if (!e.has(key(x))) issues.push(`unexpected shareholder ${x.address} at ${x.shareBps} bps`);
  return issues;
}

export async function checkFeeSharing() {
  const expected = await expectedShareholders();
  const tokens = await prisma.token.findMany({ where: { isNative: false, mintAddress: { not: null } }, select: { id: true, mintAddress: true } });
  const { chain } = getDemolitionDeps();
  let ok = 0;
  let bad = 0;
  for (const t of tokens) {
    const mint = t.mintAddress!;
    const sc = sharingConfigAddress(mint);
    let issues: string[] = [];
    let data: Prisma.FeeSharingCheckUncheckedCreateInput;
    try {
      const acc = await chain.getAccount(sc);
      const cfg = acc && acc.owner === PUMP_PROGRAMS.fees ? decodeSharingConfig(acc.data) : null;
      if (!cfg) {
        issues = ["no Pump fee-sharing config for this mint: fees go to the creator vault and cannot be attributed"];
        data = { tokenId: t.id, mint, sharingConfig: sc, exists: false, matches: false, issues };
      } else {
        if (cfg.mint !== mint) issues.push("config belongs to another mint");
        if (cfg.status !== "ACTIVE") issues.push(`config status is ${cfg.status}`);
        if (!cfg.adminRevoked) issues.push("shares are not locked: the config admin can still change them");
        if (expected) issues.push(...compareShareholders(cfg.shareholders, expected.holders));
        else issues.push("treasury wallets not registered: cannot compare shareholders");
        data = { tokenId: t.id, mint, sharingConfig: sc, exists: true, status: cfg.status, adminRevoked: cfg.adminRevoked, shareholders: cfg.shareholders, matches: issues.length === 0, issues };
      }
    } catch (e) {
      logger.warn({ mint, err: e instanceof Error ? e.message : "unknown" }, "fee-sharing check failed");
      continue; // leave the previous result in place; RPC failures are not evidence
    }
    const before = await prisma.feeSharingCheck.findUnique({ where: { tokenId: t.id } });
    await prisma.feeSharingCheck.upsert({ where: { tokenId: t.id }, create: data, update: { ...data, checkedAt: new Date() } });
    if (before && before.matches && !data.matches) {
      await recordAudit(prisma, SYSTEM_ACTOR, "fee_sharing.changed", "Token", t.id, { matches: true }, { issues: data.issues });
    }
    if (data.matches) ok++;
    else bad++;
  }
  return { checked: ok + bad, ok, mismatched: bad };
}
