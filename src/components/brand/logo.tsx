import { useId } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** $DYNASTY coin badge (original artwork). Used as the token's icon, not the site logo. */
export function LogoMark({ className, preload }: { className?: string; preload?: boolean }) {
  return (
    <Image
      src="/brand/dynasty-logo.png"
      alt=""
      aria-hidden="true"
      width={96}
      height={96}
      preload={preload}
      className={cn("shrink-0 rounded-full", className)}
    />
  );
}

type LogoVariant = "light" | "dark";

/**
 * DYNASTY 15 emblem (original artwork): a butterfly-roof villa in front of a striped
 * sunset. `light` = white house for the green navbar, `dark` = green house for white pages.
 * Transparent background. The same geometry is used for the favicons in src/app.
 */
export function LogoEmblem({ variant = "light", className }: { variant?: LogoVariant; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ink = variant === "light" ? "#ffffff" : "#18713c";
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`sun-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4c21f" />
          <stop offset="1" stopColor="#f08c2e" />
        </linearGradient>
        <clipPath id={`bands-${id}`}>
          <rect x="0" y="0" width="64" height="22.5" />
          <rect x="0" y="24" width="64" height="2.6" />
          <rect x="0" y="28" width="64" height="1.9" />
          <rect x="0" y="31.2" width="64" height="1.3" />
        </clipPath>
      </defs>
      <circle cx="32" cy="27" r="20" fill={`url(#sun-${id})`} clipPath={`url(#bands-${id})`} />
      <path
        fill={ink}
        fillRule="evenodd"
        d="M8 27.5 L32 34.5 L56 27.5 L56 31.5 L51 33 L51 53 L13 53 L13 33 L8 31.5 Z M28.5 53 L28.5 43 L35.5 43 L35.5 53 Z M17 39 h6 v6 h-6 Z M41 39 h6 v6 h-6 Z"
      />
      <rect x="5" y="55.5" width="54" height="2.5" rx="1.25" fill={ink} />
    </svg>
  );
}

/** Site logo: emblem + DYNASTY 15 wordmark. */
export function Logo({ className, variant = "light" }: { className?: string; variant?: LogoVariant }) {
  return (
    <span className={cn("flex items-center gap-1.5 min-[400px]:gap-2", className)}>
      <LogoEmblem variant={variant} className="size-8 min-[400px]:size-10 sm:size-11" />
      <span
        className={cn(
          "font-logo text-[16px] leading-none tracking-[0.02em] whitespace-nowrap min-[400px]:text-[21px] sm:text-[25px]",
          variant === "light" ? "text-white" : "text-d8-green",
        )}
      >
        DYNASTY <span className={variant === "light" ? "text-[#f4c21f]" : "text-[#f08c2e]"}>15</span>
      </span>
    </span>
  );
}
