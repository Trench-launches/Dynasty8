"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Flame, Map, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { EcosystemChip } from "@/components/layout/ecosystem-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EcosystemToken } from "@/lib/types";

const NAV = [
  { href: "/", label: "Properties", icon: Map },
  { href: "/markets", label: "Markets", icon: BarChart3 },
  { href: "/fund", label: "Fund", icon: Flame },
];

export function SiteHeader({ ecosystem }: { ecosystem: EcosystemToken }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/property") : pathname.startsWith(href));

  return (
    <header className="bg-header-gradient relative z-40 flex h-14 shrink-0 items-center gap-2 px-3 shadow-[0_2px_8px_rgba(0,0,0,0.18)] sm:h-16 sm:gap-6 sm:px-6">
      <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="DYNASTY home">
        <Logo />
      </Link>

      <nav aria-label="Main" className="ml-4 hidden items-center gap-2 md:flex">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-2 text-[15px] font-semibold tracking-[0.02em] text-white/85 transition-colors outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-ring",
              isActive(href) &&
                "text-white after:absolute after:inset-x-3 after:-bottom-[9px] after:h-[3px] after:rounded-sm after:bg-white",
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
                "grid size-9 place-items-center rounded-full text-[#dadae2] hover:text-white",
                isActive(href) && "bg-white/15 text-white",
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
            <span tabIndex={0} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <button
                type="button"
                disabled
                className="inline-flex h-9 items-center gap-2 rounded border border-white/85 px-3 text-[15px] font-semibold text-white opacity-80 sm:h-10 sm:px-5"
              >
                <Wallet className="size-4" />
                <span className="hidden sm:inline">Connect Wallet</span>
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Wallet connection is not available yet</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
