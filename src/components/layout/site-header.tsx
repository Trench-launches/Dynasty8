"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, Wallet, X } from "lucide-react";
import { ECOSYSTEM_TOKEN } from "@/data/properties";
import { cn, formatPrice, formatUsdCompact } from "@/lib/utils";
import { Change } from "@/components/ui/change";
import { Button } from "@/components/ui/button";
import { Logo } from "./logo";
import { WalletDialog } from "./wallet-dialog";

const NAV = [
  { label: "Properties", href: "/?view=grid", match: (p: string, v: string | null) => p === "/" && v === "grid" },
  { label: "Map", href: "/?view=map", match: (p: string, v: string | null) => p === "/" && v !== "grid" },
  { label: "Markets", href: "/markets", match: (p: string) => p.startsWith("/markets") },
  { label: "About", href: "/about", match: (p: string) => p.startsWith("/about") },
];

function NavLinks({ onNavigate, vertical = false }: { onNavigate?: () => void; vertical?: boolean }) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  return <NavList pathname={pathname} view={view} onNavigate={onNavigate} vertical={vertical} />;
}

function NavList({
  pathname,
  view,
  onNavigate,
  vertical,
}: {
  pathname: string;
  view: string | null;
  onNavigate?: () => void;
  vertical?: boolean;
}) {
  return (
    <nav aria-label="Main" className={cn("flex", vertical ? "flex-col gap-1" : "items-center gap-1")}>
      {NAV.map((n) => {
        const active = n.match(pathname, view);
        return (
          <Link
            key={n.label}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-xl px-3 py-2 text-sm font-extrabold transition-colors",
              vertical && "px-4 py-3 text-base",
              active ? "bg-violet text-cream" : "text-violet/75 hover:bg-violet/8 hover:text-violet",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function NavLinksSuspended(props: { onNavigate?: () => void; vertical?: boolean }) {
  const pathname = usePathname();
  return (
    <Suspense fallback={<NavList pathname={pathname} view={null} {...props} />}>
      <NavLinks {...props} />
    </Suspense>
  );
}

export function RealtyPanel({ className }: { className?: string }) {
  const m = ECOSYSTEM_TOKEN.market;
  return (
    <Link
      href="/markets#realty"
      className={cn(
        "flex items-center gap-2 rounded-2xl bg-white/80 px-2.5 py-1.5 ring-1 ring-violet/10 transition hover:ring-sunset/60",
        className,
      )}
      title="Native ecosystem token. Demo values, not live."
    >
      <span className="bg-sunset grid h-8 w-8 place-items-center rounded-full font-display text-[10px] text-white">RLT</span>
      <span className="leading-tight">
        <span className="flex items-center gap-1.5 text-xs font-extrabold text-violet">
          ${m.ticker}
          <span className="rounded bg-tangerine/30 px-1 text-[9px] uppercase tracking-wide text-[#9a4a10]">Demo</span>
        </span>
        <span className="flex items-center gap-2 text-[11px] font-bold tabular-nums text-violet/70">
          {formatPrice(m.priceUsd)}
          <span className="text-violet/40">·</span>
          {formatUsdCompact(m.marketCapUsd)} mcap
          <Change value={m.change24hPct} className="text-[11px]" />
        </span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-violet/10 bg-cream/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
          <Link href="/" aria-label="Home" className="shrink-0">
            <Logo />
          </Link>
          <div className="ml-4 hidden lg:block">
            <NavLinksSuspended />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <RealtyPanel className="hidden md:flex" />
            <Button onClick={() => setWalletOpen(true)} className="hidden sm:inline-flex">
              <Wallet /> Connect Wallet
            </Button>
            <Button
              variant="soft"
              size="icon"
              className="lg:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {menuOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-violet/10 bg-cream lg:hidden"
            >
              <div className="space-y-3 px-4 py-4">
                <NavLinksSuspended vertical onNavigate={() => setMenuOpen(false)} />
                <RealtyPanel className="md:hidden" />
                <Button
                  className="w-full sm:hidden"
                  onClick={() => {
                    setMenuOpen(false);
                    setWalletOpen(true);
                  }}
                >
                  <Wallet /> Connect Wallet
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      <WalletDialog open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );
}
