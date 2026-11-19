import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * DYNASTY logo: a round badge (cream ring, dark plum disc, pink triple-line house), cut out of
 * its square so the corners are transparent. Files in public/brand (bump -vN when replacing):
 * - logo-badge-v1.png       512px master
 * - logo-badge-v1-128.png   128px copy; the badge never shows larger than ~64px on the site
 * The favicon (src/app/icon.png) and iOS icon (src/app/apple-icon.png) are cut from the same art.
 */
const BADGE = "/brand/logo-badge-v1-128.png";
const BADGE_SIZE = 128;

type LogoVariant = "light" | "dark";

/** The badge on its own: the $DYNASTY token icon, the address-bar icon and the HQ pin's head. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full", className)}>
      <Image src={BADGE} alt="" width={BADGE_SIZE} height={BADGE_SIZE} sizes="64px" className="size-full" />
    </span>
  );
}

/**
 * Site logo: the badge with the DYNASTY name beside it. `light` = white name for the dark purple
 * theme (every page today), `dark` = plum name for light backgrounds.
 */
export function Logo({ className, variant = "light" }: { className?: string; variant?: LogoVariant }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src={BADGE}
        alt=""
        width={BADGE_SIZE}
        height={BADGE_SIZE}
        sizes="56px"
        loading="eager"
        className="size-9 min-[400px]:size-10 sm:size-12"
      />
      <span
        className={cn(
          "font-display text-xl leading-none font-bold tracking-[0.12em] sm:text-2xl",
          variant === "light" ? "text-white" : "text-[#210a28]",
        )}
      >
        DYNASTY
      </span>
    </span>
  );
}
