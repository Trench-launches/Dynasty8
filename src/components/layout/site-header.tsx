"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, ChevronDown, ChevronLeft, ChevronRight, Clock, Flame, Home, Map, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/logo";
import { EcosystemChip } from "@/components/layout/ecosystem-chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EcosystemToken } from "@/lib/types";

/** Shown in the address bar, whatever host serves the page (localhost, previews). */
const SITE_HOST = "vicecityrealestate.city";
/** The project's X profile. */
const X_URL = "https://x.com/Dynasty15fund";

const NAV = [
  { href: "/", label: "Properties", icon: Map },
  { href: "/markets", label: "Markets", icon: BarChart3 },
  { href: "/fund", label: "Fund", icon: Flame },
];

/** The Navigation API (Chromium) knows whether back/forward can go anywhere; other browsers fall back to the history length. */
type NavigationApi = EventTarget & { canGoBack: boolean; canGoForward: boolean };
const navigationApi = () => (window as unknown as { navigation?: NavigationApi }).navigation;

function subscribeHistory(onChange: () => void) {
  const nav = navigationApi();
  nav?.addEventListener("currententrychange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    nav?.removeEventListener("currententrychange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/** Raised plum browser-toolbar button. */
const chromeButton =
  "grid h-9 shrink-0 place-items-center border border-vc-line-strong bg-linear-to-b from-vc-surface-3 to-vc-surface-2 text-vc-text shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] transition-colors outline-none hover:from-vc-line-strong hover:to-vc-surface-3 active:from-vc-surface-2 active:to-vc-surface-2 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-vc-text/35 sm:h-10";

/**
 * Site header styled as a web browser's toolbar: back/forward, home, a pages menu, an address bar
 * showing the current page, and the X and $DYNASTY buttons on the right.
 */
export function SiteHeader({ ecosystem }: { ecosystem: EcosystemToken }) {
  const pathname = usePathname();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const history = {
    back: useSyncExternalStore(subscribeHistory, () => navigationApi()?.canGoBack ?? window.history.length > 1, () => false),
    forward: useSyncExternalStore(subscribeHistory, () => navigationApi()?.canGoForward ?? true, () => false),
  };

  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/property") : pathname.startsWith(href));
  const address = `${SITE_HOST}${pathname}`;

  return (
    <header className="relative z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-vc-line bg-chrome-gradient px-2 sm:h-16 sm:gap-2.5 sm:px-4">
      {/* Back / forward */}
      <div className="hidden shrink-0 sm:flex">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={!history.back}
          aria-label="Back"
          className={cn(chromeButton, "w-11 rounded-l-md")}
        >
          <ChevronLeft className="size-5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => router.forward()}
          disabled={!history.forward}
          aria-label="Forward"
          className={cn(chromeButton, "-ml-px w-11 rounded-r-md")}
        >
          <ChevronRight className="size-5" strokeWidth={2.5} />
        </button>
      </div>

      <Link href="/" aria-label="Home" className={cn(chromeButton, "w-10 rounded-md sm:w-11")}>
        <Home className="size-[18px]" strokeWidth={2.25} />
      </Link>

      <PagesMenu isActive={isActive}>
        <button type="button" aria-label="Pages" className={cn(chromeButton, "flex w-12 gap-0.5 rounded-md px-2 sm:w-16")}>
          <Clock className="size-[18px]" strokeWidth={2.25} />
          <ChevronDown className="size-3.5" strokeWidth={3} />
        </button>
      </PagesMenu>

      {/* Address bar */}
      <div className="flex h-9 min-w-0 flex-1 overflow-hidden rounded-md border border-vc-line-strong bg-vc-surface shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)] sm:h-10">
        <PagesMenu isActive={isActive}>
          <button
            type="button"
            aria-label={`Current page: ${address}. Show pages`}
            className="flex min-w-0 flex-1 items-center gap-2 px-2.5 text-left outline-none focus-visible:bg-vc-surface-2 sm:px-3.5"
          >
            <LogoMark className="size-5 sm:size-6" />
            <span className="truncate text-[15px] text-vc-text sm:text-[17px]">{address}</span>
          </button>
        </PagesMenu>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          aria-label="Refresh"
          className={cn(chromeButton, "h-full w-10 border-0 border-l sm:h-full sm:w-11")}
        >
          <RotateCw className={cn("size-4", refreshing && "animate-spin")} strokeWidth={2.5} />
        </button>
      </div>

      {/* Page tabs (on small screens the pages menu covers this) */}
      <nav aria-label="Pages" className="hidden shrink-0 lg:flex">
        {NAV.map(({ href, label, icon: Icon }, i) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            title={label}
            className={cn(
              chromeButton,
              "flex w-11 gap-2 text-sm font-bold tracking-wide uppercase xl:w-auto xl:px-4",
              i === 0 ? "rounded-l-md" : "-ml-px",
              i === NAV.length - 1 && "rounded-r-md",
              isActive(href) && "z-[1] border-vc-violet from-vc-primary to-vc-primary-strong text-white hover:from-vc-primary hover:to-vc-primary-strong",
            )}
          >
            <Icon className="size-4" strokeWidth={2.5} aria-hidden />
            <span className="sr-only xl:not-sr-only">{label}</span>
          </Link>
        ))}
      </nav>

      <a
        href={X_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="DYNASTY on X"
        className={cn(chromeButton, "w-10 rounded-md sm:w-11")}
      >
        <XLogo className="size-4" />
      </a>

      <EcosystemChip token={ecosystem} />
    </header>
  );
}

/** The site's pages, opened from the history button and the address bar. */
function PagesMenu({ isActive, children }: { isActive: (href: string) => boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0.5 border border-vc-line bg-vc-surface p-1.5">
        <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-vc-faint uppercase">Pages</p>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-semibold text-vc-text outline-none hover:bg-vc-surface-2 focus-visible:bg-vc-surface-2",
              isActive(href) && "bg-vc-primary/10 text-vc-accent hover:bg-vc-primary/15",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            <span className="text-xs font-normal text-vc-faint">
              {SITE_HOST}
              {href}
            </span>
          </Link>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
