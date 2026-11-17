import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

/** Original lockup: roofline over a striped setting sun, then the wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 40" className={cn("h-9 w-11", className)} aria-hidden>
      <defs>
        <linearGradient id="logo-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB36B" />
          <stop offset="0.6" stopColor="#FF8066" />
          <stop offset="1" stopColor="#FF6B9D" />
        </linearGradient>
        <clipPath id="logo-sun-clip">
          <rect x="0" y="0" width="48" height="25" />
          <rect x="0" y="27" width="48" height="2.6" />
          <rect x="0" y="31.6" width="48" height="2" />
        </clipPath>
      </defs>
      <circle cx="24" cy="30" r="13" fill="url(#logo-sun)" clipPath="url(#logo-sun-clip)" />
      <path d="M3 20 L24 4 L45 20" fill="none" stroke="#30204F" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="34" y="6" width="4.4" height="8" rx="1" fill="#30204F" />
      <path d="M8 37 H40" stroke="#30204F" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="flex items-baseline gap-1">
          <span className={cn("font-display text-[22px] tracking-[0.06em]", inverted ? "text-cream" : "text-violet")}>
            {brand.wordmark}
          </span>
          <span className="text-sunset font-display text-[26px] italic leading-none">{brand.numeral}</span>
        </span>
        <span
          className={cn(
            "text-[9px] font-extrabold uppercase tracking-[0.35em]",
            inverted ? "text-cream/70" : "text-violet/55",
          )}
        >
          {brand.subtitle}
        </span>
      </span>
    </span>
  );
}
