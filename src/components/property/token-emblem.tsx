import { cn } from "@/lib/utils";

/** Generated token badge used until a real token image URL exists. */
export function TokenEmblem({ ticker, className }: { ticker: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sunset font-display text-[11px] tracking-wide text-white shadow ring-2 ring-white",
        className,
      )}
      aria-hidden
    >
      {ticker.slice(0, 3)}
    </span>
  );
}
