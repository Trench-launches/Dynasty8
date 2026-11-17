import { TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatPct } from "@/lib/utils";

export function Change({ value, className }: { value: number; className?: string }) {
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-bold tabular-nums",
        up ? "text-[#0d9a70]" : "text-[#d6304f]",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {formatPct(value)}
    </span>
  );
}
