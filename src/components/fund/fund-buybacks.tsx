import { ExternalLink, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/format";
import { formatFundDate, formatSol, formatTokenAmount } from "@/lib/fund-format";
import type { BuybackVerification, FundBuybackDto, FundPendingActionDto } from "@/contracts/demolition-fund";
import { PanelHeader } from "@/components/ui/panel";

const solscan = (signature: string) => `https://solscan.io/tx/${signature}`;

const STATUS: Record<BuybackVerification, { label: string; className: string }> = {
  PLANNED: { label: "Planned", className: "bg-vc-surface-3 text-vc-text-2" },
  AWAITING_APPROVAL: { label: "Awaiting signers", className: "bg-vc-cream/15 text-vc-cream" },
  AWAITING_EXECUTION: { label: "Approved", className: "bg-vc-cream/15 text-vc-cream" },
  SWAP_PENDING: { label: "Purchase confirming", className: "bg-vc-violet/20 text-vc-lilac" },
  PURCHASE_VERIFIED: { label: "Purchase verified", className: "bg-vc-violet/15 text-vc-lilac" },
  BURN_PENDING: { label: "Burn confirming", className: "bg-vc-violet/20 text-vc-lilac" },
  BURN_VERIFIED: { label: "Burn verified", className: "bg-vc-primary text-white" },
  CANCELLED: { label: "Cancelled", className: "bg-vc-surface-3 text-vc-faint" },
  FAILED: { label: "Failed", className: "bg-vc-danger/15 text-vc-danger" },
};

interface Props {
  buybacks: FundBuybackDto[];
  pending: FundPendingActionDto[];
  ticker: string;
  decimals: number | null;
}

/** Buyback history with verification status, plus multisig actions waiting for signers. */
export function FundBuybacks({ buybacks, pending, ticker, decimals }: Props) {
  const token = (raw: string | null) => (raw === null ? "—" : `${formatTokenAmount(raw, decimals)} $${ticker}`);

  return (
    <section aria-labelledby="fund-buybacks" className="min-w-0 border border-vc-line bg-vc-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <PanelHeader id="fund-buybacks" title="Buyback history" note="Buy back &amp; burn" className="-mx-px -mt-px" />

      {pending.length > 0 && (
        <div className="border-b border-vc-line bg-vc-surface-2 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-vc-text-2">
            <Users className="size-3.5" aria-hidden /> Waiting for multisig signers
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {pending.map((p) => (
              <li key={p.proposalPda} className="rounded-[3px] border border-vc-line bg-vc-surface px-3 py-2 text-xs">
                <span className="font-semibold text-vc-text">{p.purpose === "SWAP" ? `Buy ${formatSol(p.amount)} of $${ticker}` : `Burn ${token(p.amount)}`}</span>
                <span className="mt-0.5 block text-vc-muted">
                  {p.status === "PREPARED" ? "Prepared, not yet proposed on-chain" : `${p.approvals} of ${p.threshold} approvals`}
                  {p.status === "APPROVED" && " · ready to execute"} · proposal #{p.transactionIndex}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {buybacks.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-vc-faint">
          No buybacks yet. The first one runs once verified fees reach the minimum and the multisig approves it.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-vc-line text-left text-[10px] tracking-wider text-vc-faint uppercase">
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">SOL spent</th>
                  <th className="px-4 py-2 text-right font-semibold">${ticker} bought</th>
                  <th className="px-4 py-2 text-right font-semibold">${ticker} burned</th>
                  <th className="px-4 py-2 font-semibold">Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vc-line">
                {buybacks.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-vc-text-2">{formatFundDate(b.confirmedAt ?? b.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Badge v={b.verification} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.solSpentLamports ? formatSol(b.solSpentLamports) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{token(b.dynastyPurchasedRaw)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.dynastyBurnedRaw === "0" ? "—" : token(b.dynastyBurnedRaw)}</td>
                    <td className="px-4 py-2">
                      <Sigs swap={b.swapSignature} burn={b.burnSignature} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-vc-line md:hidden">
            {buybacks.map((b) => (
              <li key={b.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-vc-muted">{formatFundDate(b.confirmedAt ?? b.createdAt)}</span>
                  <Badge v={b.verification} />
                </div>
                <p className="tabular-nums">
                  {b.solSpentLamports ? formatSol(b.solSpentLamports) : "—"} → {token(b.dynastyPurchasedRaw)}
                </p>
                {b.dynastyBurnedRaw !== "0" && <p className="text-xs text-vc-text-2">Burned {token(b.dynastyBurnedRaw)}</p>}
                <Sigs swap={b.swapSignature} burn={b.burnSignature} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Badge({ v }: { v: BuybackVerification }) {
  const s = STATUS[v];
  return <span className={cn("inline-flex rounded-[3px] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.className)}>{s.label}</span>;
}

function Sigs({ swap, burn }: { swap: string | null; burn: string | null }) {
  if (!swap && !burn) return <span className="text-xs text-vc-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {swap && <SigLink label="Buy" signature={swap} />}
      {burn && <SigLink label="Burn" signature={burn} />}
    </span>
  );
}

function SigLink({ label, signature }: { label: string; signature: string }) {
  return (
    <a
      href={solscan(signature)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${label.toLowerCase()} transaction on Solscan`}
      className="inline-flex items-center gap-1 rounded-[3px] border border-vc-line-strong px-2 py-0.5 text-xs font-semibold text-vc-accent hover:border-vc-violet"
    >
      {label} {shortAddress(signature)} <ExternalLink className="size-3" />
    </a>
  );
}
