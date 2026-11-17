import { BadgeCheck, CircleDashed, Clock, MapPinOff, Star, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOKEN_STATUS_LABELS } from "@/data/regions";
import { formatChange } from "@/lib/format";
import type { MarketSnapshot, Property, TokenStatus } from "@/lib/types";

const STATUS_STYLES: Record<TokenStatus, string> = {
  live: "border-d8-green bg-d8-green text-white",
  coming_soon: "border-[#ced4da] bg-[#f8f9fa] text-[#495057]",
  unavailable: "border-destructive/40 bg-destructive/10 text-destructive line-through decoration-destructive/40",
};

export function TokenStatusBadge({ status, className }: { status: TokenStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold tracking-wider whitespace-nowrap uppercase",
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
        "inline-flex items-center gap-1 rounded bg-[#ffc107] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-[#212529] uppercase",
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
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-d8-green", className)}>
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

/** Flags market numbers that are not live: generated demo data, or a delayed (stale) snapshot. */
export function MarketDataTag({ market, className }: { market: MarketSnapshot | null | undefined; className?: string }) {
  if (market?.stale) {
    return (
      <span
        title={`Delayed market data, last updated ${new Date(market.updatedAt).toLocaleString()}`}
        className={cn(
          "rounded border border-amber-300/50 bg-amber-300/15 px-1 py-px text-[9px] font-bold tracking-wider text-amber-200 uppercase",
          className,
        )}
      >
        Delayed
      </span>
    );
  }
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
        value == null ? "text-cream/50" : value >= 0 ? "text-d8-green" : "text-destructive",
        className,
      )}
    >
      {formatChange(value)}
    </span>
  );
}
