import Link from "next/link";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

const LINKS = [
  { href: "/", label: "Properties" },
  { href: "/markets", label: "Markets" },
];

const DISCLAIMER = "Not affiliated with Rockstar Games or Take-Two Interactive. Nothing here is financial advice.";

/**
 * Site footer. `compact` is a single slim row for the full-screen map page, where every pixel
 * of height goes to the map; the default version sits at the bottom of scrolling pages.
 */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  const year = new Date().getFullYear();

  if (compact) {
    return (
      <footer className="hidden shrink-0 items-center gap-4 bg-vc-surface border-t border-vc-line px-3 py-1.5 text-[11px] text-white/75 sm:flex sm:px-6">
        <span className="font-semibold text-white">© {year} DYNASTY</span>
        <FooterLinks className="gap-3" />
        <span className="ml-auto truncate">{DISCLAIMER}</span>
      </footer>
    );
  }

  return (
    <footer className="mt-auto shrink-0 bg-vc-surface border-t border-vc-line text-white/80">
      <div className="flex flex-col gap-4 px-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" aria-label="DYNASTY home" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white">
            <Logo />
          </Link>
          <FooterLinks className="gap-4 text-sm" />
        </div>
        <div className="text-xs sm:text-right">
          <p className="font-semibold text-white">© {year} DYNASTY. All rights reserved.</p>
          <p className="mt-1 text-white/65">{DISCLAIMER}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Footer" className={cn("flex items-center font-semibold", className)}>
      {LINKS.map(({ href, label }) => (
        <Link key={href} href={href} className="rounded text-white/85 outline-none hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-white">
          {label}
        </Link>
      ))}
    </nav>
  );
}
