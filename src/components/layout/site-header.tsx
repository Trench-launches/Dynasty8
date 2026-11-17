"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Map, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { EcosystemChip } from "@/components/layout/ecosystem-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EcosystemToken } from "@/lib/types";

const NAV = [
  { href: "/", label: "Properties", icon: Map },
  { href: "/markets", label: "Markets", icon: BarChart3 },
];

export function SiteHeader({ ecosystem }: { ecosystem: EcosystemToken }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/property") : pathname.startsWith(href));

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-black px-3 sm:h-16 sm:gap-6 sm:px-5">
      <div aria-hidden className="bg-sunset-gradient absolute inset-x-0 bottom-0 h-px opacity-60" />
      <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Dynasty 8 home">
        <Logo className="max-sm:[&_.font-script]:hidden" />
      </Link>

      <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-2 font-display text-lg tracking-[0.12em] text-cream/65 transition-colors outline-none hover:text-cream focus-visible:ring-2 focus-visible:ring-ring",
              isActive(href) && "text-cream after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-sunset",
            )}
          >
            {label.toUpperCase()}
          </Link>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <nav aria-label="Main (compact)" className="flex items-center gap-1 md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "grid size-9 place-items-center rounded-lg text-cream/60 hover:text-cream",
                isActive(href) && "bg-white/10 text-cream",
              )}
            >
              <Icon className="size-4.5" />
            </Link>
          ))}
        </nav>

        <EcosystemChip token={ecosystem} />

        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper: disabled buttons don't emit hover events */}
            <span tabIndex={0} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <button
                type="button"
                disabled
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-sunset-gradient px-3 text-sm font-bold text-navy opacity-60 sm:px-4"
              >
                <Wallet className="size-4" />
                <span className="hidden sm:inline">Connect Wallet</span>
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Wallet connection is coming soon</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
