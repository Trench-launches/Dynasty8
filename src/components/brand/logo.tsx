import Image from "next/image";
import { cn } from "@/lib/utils";

/** DYNASTY coin badge (original artwork, generated for the project). */
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

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="size-10 sm:size-11" preload />
      {!compact && (
        <span className="font-display text-[20px] leading-none font-bold tracking-[0.06em] text-white uppercase sm:text-[24px]">Dynasty</span>
      )}
    </span>
  );
}
