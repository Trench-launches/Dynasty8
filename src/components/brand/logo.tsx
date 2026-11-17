import { cn } from "@/lib/utils";

/** Original Dynasty 8 mark: a roofline crowning a sunset "8". */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id="d8-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff6b9d" />
          <stop offset="0.55" stopColor="#ff8066" />
          <stop offset="1" stopColor="#ffb36b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#0a0a0d" stroke="#ffffff" strokeOpacity="0.12" />
      <path d="M8 21 L24 8 L40 21" fill="none" stroke="url(#d8-logo-grad)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="25.5" r="5" fill="none" stroke="url(#d8-logo-grad)" strokeWidth="3.4" />
      <circle cx="24" cy="35.5" r="6" fill="none" stroke="url(#d8-logo-grad)" strokeWidth="3.4" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="size-9" />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[26px] tracking-[0.08em] text-cream">
            DYNASTY <span className="text-sunset-gradient">8</span>
          </span>
          <span className="-mt-0.5 font-script text-[13px] text-tropic/90">Leonida Real Estate</span>
        </span>
      )}
    </span>
  );
}
