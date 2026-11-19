import { CheckCircle2, ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";
import { shortAddress } from "@/lib/format";
import { formatBps, formatFundDate, formatSol, formatTokenAmount } from "@/lib/fund-format";
import type { FundSummaryDto } from "@/contracts/demolition-fund";
import { PanelHeader } from "@/components/ui/panel";

const solscanAccount = (address: string) => `https://solscan.io/account/${address}`;

const ROLE_LABEL = { FUND: "Demolition Fund", ECOSYSTEM: "Ecosystem treasury", OPERATIONS: "Operations treasury" } as const;

/**
 * Treasury transparency: balances observed on-chain at the last reconciliation, what the
 * ledger says the fund must still hold, the treasury wallets and their multisig thresholds,
 * and whether every property's Pump fee-sharing config pays the expected wallets.
 * Shows explicit empty states until there is verified data; never estimates.
 */
export function FundTreasury({ summary }: { summary: FundSummaryDto }) {
  const { treasury: t, allocation: a, feeSharing: fs, dynasty } = summary;
  const ticker = `$${dynasty.ticker}`;
  const split = t.allocationMode === "ON_CHAIN_SPLIT";

  return (
    <section aria-labelledby="fund-treasury" className="min-w-0 border border-vc-line bg-vc-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <PanelHeader id="fund-treasury" title="Treasury balances" note="Transparency" className="-mx-px -mt-px" />
      <div className="border-b border-vc-line px-4 py-3">
        <p className="text-[15px] leading-relaxed text-vc-text-2">
          {split
            ? `Pump.fun pays each property's fees straight to three wallets: ${formatBps(a.buybackBps)} to the fund, ${formatBps(a.ecosystemBps)} ecosystem, ${formatBps(a.operationsBps)} operations.`
            : `The fund receives all property fees and passes on ${formatBps(a.ecosystemBps)} ecosystem and ${formatBps(a.operationsBps)} operations.`}
        </p>
      </div>

      <dl className="grid gap-px bg-vc-surface-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cell
          label="Fund balance (on-chain)"
          value={t.fundBalanceLamports ? formatSol(t.fundBalanceLamports) : "Not observed yet"}
          note={t.balanceObservedAt ? `Read ${formatFundDate(t.balanceObservedAt)}` : "Shown after the first reconciliation"}
          muted={!t.fundBalanceLamports}
        />
        <Cell label="Verified revenue held" value={formatSol(t.liabilitiesLamports)} note="Unspent buyback share + shares owed onward" />
        <Cell label="Reserve" value={formatSol(t.reserveLamports)} note="Kept for network fees; never spent on buybacks" />
        <Cell label={`${ticker} awaiting burn`} value={`${formatTokenAmount(t.unburnedDynastyRaw, dynasty.decimals)} ${ticker}`} note="Bought but not yet burned" />
        {split ? (
          <>
            <Cell label="Paid to ecosystem" value={formatSol(t.ecosystemPaidDirectLamports)} note="Directly by Pump.fun fee sharing" />
            <Cell label="Paid to operations" value={formatSol(t.operationsPaidDirectLamports)} note="Directly by Pump.fun fee sharing" />
          </>
        ) : (
          <>
            <Cell label="Owed to ecosystem" value={formatSol(t.ecosystemOwedLamports)} note="Held by the fund until disbursed" />
            <Cell label="Owed to operations" value={formatSol(t.operationsOwedLamports)} note="Held by the fund until disbursed" />
          </>
        )}
        <Cell
          label="Fee-sharing checks"
          value={fs.checked === 0 ? "No tokens live yet" : `${fs.matching} of ${fs.checked} verified`}
          note={fs.lastCheckedAt ? `Checked ${formatFundDate(fs.lastCheckedAt)}` : "Each property's Pump config is read on-chain"}
          muted={fs.checked === 0}
        />
        <Cell
          label="Reconciliation"
          value={summary.status.lastReconciliation ? (summary.status.lastReconciliation.ok ? "Balanced" : "Shortfall") : "Not run yet"}
          note={summary.status.lastReconciliation ? formatFundDate(summary.status.lastReconciliation.at) : "Ledger vs chain"}
          muted={!summary.status.lastReconciliation}
        />
      </dl>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-[17px] tracking-[0.04em] text-vc-accent uppercase">Treasury wallets</h3>
          {t.wallets.length === 0 ? (
            <p className="mt-2 text-sm text-vc-faint">Treasury wallets have not been registered yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-vc-line rounded-[3px] border border-vc-line">
              {t.wallets.map((w) => (
                <li key={w.role} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold text-vc-text">{ROLE_LABEL[w.role]}</span>
                    <span className="flex items-center gap-1 text-xs text-vc-muted">
                      {w.isMultisig && w.threshold ? (
                        <>
                          <ShieldCheck className="size-3.5 text-vc-accent" aria-hidden /> Squads multisig, {w.threshold} of {w.members} signers
                        </>
                      ) : (
                        "Single-signature wallet"
                      )}
                    </span>
                  </span>
                  <a
                    href={solscanAccount(w.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-[3px] border border-vc-line-strong px-2 py-0.5 text-xs font-semibold text-vc-accent hover:border-vc-violet"
                  >
                    {shortAddress(w.address)} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-[17px] tracking-[0.04em] text-vc-accent uppercase">Property fee sharing</h3>
          {fs.checked === 0 ? (
            <p className="mt-2 text-sm text-vc-faint">No property token has launched, so there is nothing to check yet.</p>
          ) : fs.issues.length === 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-vc-accent">
              <CheckCircle2 className="size-4" aria-hidden /> Every live property pays the expected wallets, and its shares are locked.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {fs.issues.map((i) => (
                <li key={i.mint} className="rounded-[3px] border border-vc-cream/40 bg-vc-surface-2 px-3 py-2 text-xs text-vc-cream">
                  <span className="flex items-center gap-1 font-semibold">
                    <TriangleAlert className="size-3.5" aria-hidden /> ${i.ticker}
                  </span>
                  {i.issues.join("; ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Cell({ label, value, note, muted = false }: { label: string; value: string; note: string; muted?: boolean }) {
  return (
    <div className="min-w-0 bg-vc-surface px-4 py-3">
      <dt className="truncate text-[10px] tracking-wider text-vc-faint uppercase">{label}</dt>
      <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${muted ? "text-vc-faint" : "text-vc-text"}`}>{value}</dd>
      <dd className="truncate text-xs text-vc-muted">{note}</dd>
    </div>
  );
}
