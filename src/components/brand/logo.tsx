import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * DYNASTY 15 logo (original artwork): roof line with a gold sun and the wordmark.
 * Transparent PNGs in public/brand, 1024x515:
 * - dynasty15-logo.png      white house, for the green header / dark backgrounds
 * - dynasty15-logo-dark.png green house, for white pages
 */
// 360px-wide copies (scripts/make-thumbnails.mjs); the logo never shows wider than ~200px.
const LOGO = { light: "/brand/dynasty15-logo-sm.png", dark: "/brand/dynasty15-logo-dark-sm.png" } as const;
const LOGO_W = 1024;
const LOGO_H = 515;

type LogoVariant = keyof typeof LOGO;

/** $DYNASTY token icon: the logo on a green coin, so it reads on light backgrounds. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-vc-primary", className)}>
      <Image src={LOGO.light} alt="" width={LOGO_W} height={LOGO_H} sizes="64px" className="h-auto w-[80%]" />
    </span>
  );
}

/** Site logo. `light` = white house for the purple theme (every page), `dark` = green house, kept for light backgrounds. */
export function Logo({ className, variant = "light" }: { className?: string; variant?: LogoVariant }) {
  return (
    <span className={cn("flex items-center", className)}>
      <Image
        src={LOGO[variant]}
        alt="DYNASTY 15"
        width={LOGO_W}
        height={LOGO_H}
        sizes="110px"
        loading="eager"
        className="h-9 w-auto min-[400px]:h-10 sm:h-[50px]"
      />
    </span>
  );
}
