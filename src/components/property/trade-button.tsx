import { Lock } from "lucide-react";
import { trading } from "@/lib/integrations/mock";
import { cn } from "@/lib/utils";

/** Trading is not available in the prototype; the control is disabled and says so. */
export function TradeButton({ ticker, className }: { ticker: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <button
        type="button"
        disabled
        aria-disabled
        className="inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-violet/10 px-5 text-sm font-extrabold text-violet/55 ring-1 ring-dashed ring-violet/25"
      >
        <Lock className="size-4" aria-hidden />
        Trade ${ticker} on Pump.fun
        <span className="rounded-full bg-tangerine/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#9a4a10]">
          Coming soon
        </span>
      </button>
      <p className="text-[11px] text-violet/55">{trading.reason}</p>
    </div>
  );
}
