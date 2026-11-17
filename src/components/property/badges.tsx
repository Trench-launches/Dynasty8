import { BadgeCheck, CircleDashed, Clock, MapPinOff, Star, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOKEN_STATUS_LABELS } from "@/data/regions";
import { formatChange } from "@/lib/format";
import type { MarketSnapshot, Property, TokenStatus } from "@/lib/types";

const STATUS_STYLES: Record<TokenStatus, string> = {
  live: "border-coral/40 bg-coral/15 text-tropic",
  coming_soon: "border-white/15 bg-white/5 text-cream/75",
  unavailable: "border-white/10 bg-white/5 text-cream/45 line-through decoration-cream/40",
};

export function TokenStatusBadge({ status, className }: { status: TokenStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wider whitespace-nowrap uppercase",
        STATUS_STYLES[status],
        className,
      )}
    >
      {status === "live" && <span className="size-1.5 rounded-full bg-coral shadow-[0_0_6px] shadow-coral" />}
      {status === "coming_soon" && <Clock className="size-3" />}
      {status === "unavailable" && <TriangleAlert className="size-3 no-underline" />}
      {TOKEN_STATUS_LABELS[status]}
    </span>
  );
}

export function FeaturedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-tropic/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-tropic uppercase",
        className,
      )}
    >
      <Star className="size-3 fill-current" /> Featured
    </span>
  );
}

export function VerificationBadge({ property, className }: { property: Property; className?: string }) {
  const { status } = property.verification;
  if (status === "confirmed") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-emerald-300", className)}>
        <BadgeCheck className="size-3.5" /> Confirmed location
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] text-cream/55", className)}>
      <CircleDashed className="size-3.5" /> {status === "reported" ? "Reported location" : "Unverified location"}
    </span>
  );
}

export function LocationPendingBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] text-cream/50", className)}>
      <MapPinOff className="size-3.5" /> Map placement pending
    </span>
  );
}

export function DemoTag({ market, className }: { market: MarketSnapshot | null | undefined; className?: string }) {
  if (market?.source !== "demo") return null;
  return (
    <span
      title="Generated demo data — not real market information"
      className={cn(
        "rounded border border-neon/50 bg-neon/15 px-1 py-px text-[9px] font-bold tracking-wider text-neon uppercase",
        className,
      )}
    >
      Demo
    </span>
  );
}

export function ChangeText({ value, className }: { value: number | null | undefined; className?: string }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        value == null ? "text-cream/50" : value >= 0 ? "text-emerald-300" : "text-rose-300",
        className,
      )}
    >
      {formatChange(value)}
    </span>
  );
}
