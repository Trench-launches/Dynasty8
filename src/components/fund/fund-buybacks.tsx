import { ExternalLink, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/format";
import { formatFundDate, formatSol, formatTokenAmount } from "@/lib/fund-format";
import type { BuybackVerification, FundBuybackDto, FundPendingActionDto } from "@/contracts/demolition-fund";
import { PanelHeader } from "@/components/ui/panel";

const solscan = (signature: string) => `https://solscan.io/tx/${signature}`;

const STATUS: Record<BuybackVerification, { label: string; className: string }> = {
  PLANNED: { label: "Planned", className: "bg-[#e9ecef] text-[#495057]" },
  AWAITING_APPROVAL: { label: "Awaiting signers", className: "bg-[#fff3cd] text-[#664d03]" },
  AWAITING_EXECUTION: { label: "Approved", className: "bg-[#fff3cd] text-[#664d03]" },
  SWAP_PENDING: { label: "Purchase confirming", className: "bg-[#cfe2ff] text-[#084298]" },
  PURCHASE_VERIFIED: { label: "Purchase verified", className: "bg-d8-teal/15 text-d8-teal" },
  BURN_PENDING: { label: "Burn confirming", className: "bg-[#cfe2ff] text-[#084298]" },
  BURN_VERIFIED: { label: "Burn verified", className: "bg-d8-green text-white" },
  CANCELLED: { label: "Cancelled", className: "bg-[#e9ecef] text-[#868e96]" },
  FAILED: { label: "Failed", className: "bg-[#f8d7da] text-[#842029]" },
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
    <section aria-labelledby="fund-buybacks" className="min-w-0 border border-[#e3e3e3] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <PanelHeader id="fund-buybacks" title="Buyback history" note="Buy back &amp; burn" className="-mx-px -mt-px" />

      {pending.length > 0 && (
        <div className="border-b border-[#dee2e6] bg-[#f8f9fa] px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#495057]">
            <Users className="size-3.5" aria-hidden /> Waiting for multisig signers
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {pending.map((p) => (
              <li key={p.proposalPda} className="rounded-[3px] border border-[#dee2e6] bg-white px-3 py-2 text-xs">
                <span className="font-semibold text-[#212529]">{p.purpose === "SWAP" ? `Buy ${formatSol(p.amount)} of $${ticker}` : `Burn ${token(p.amount)}`}</span>
                <span className="mt-0.5 block text-[#6c757d]">
                  {p.status === "PREPARED" ? "Prepared, not yet proposed on-chain" : `${p.approvals} of ${p.threshold} approvals`}
                  {p.status === "APPROVED" && " · ready to execute"} · proposal #{p.transactionIndex}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {buybacks.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-[#868e96]">
          No buybacks yet. The first one runs once verified fees reach the minimum and the multisig approves it.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#dee2e6] text-left text-[10px] tracking-wider text-[#868e96] uppercase">
                  <th className="px-4 py-2 font-semibold">Date</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">SOL spent</th>
                  <th className="px-4 py-2 text-right font-semibold">${ticker} bought</th>
                  <th className="px-4 py-2 text-right font-semibold">${ticker} burned</th>
                  <th className="px-4 py-2 font-semibold">Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dee2e6]">
                {buybacks.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-[#495057]">{formatFundDate(b.confirmedAt ?? b.createdAt)}</td>
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
          <ul className="divide-y divide-[#dee2e6] md:hidden">
            {buybacks.map((b) => (
              <li key={b.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#6c757d]">{formatFundDate(b.confirmedAt ?? b.createdAt)}</span>
                  <Badge v={b.verification} />
                </div>
                <p className="tabular-nums">
                  {b.solSpentLamports ? formatSol(b.solSpentLamports) : "—"} → {token(b.dynastyPurchasedRaw)}
                </p>
                {b.dynastyBurnedRaw !== "0" && <p className="text-xs text-[#495057]">Burned {token(b.dynastyBurnedRaw)}</p>}
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
  if (!swap && !burn) return <span className="text-xs text-[#868e96]">—</span>;
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
      className="inline-flex items-center gap-1 rounded-[3px] border border-[#ced4da] px-2 py-0.5 text-xs font-semibold text-d8-green hover:border-d8-green"
    >
      {label} {shortAddress(signature)} <ExternalLink className="size-3" />
    </a>
  );
}
