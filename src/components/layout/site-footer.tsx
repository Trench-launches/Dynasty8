import Link from "next/link";
import { brand } from "@/config/brand";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="bg-midnight text-cream/75">
      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-8 md:grid-cols-[1fr_2fr] lg:px-6">
        <div>
          <Logo inverted />
          <p className="mt-3 text-sm">{brand.tagline}.</p>
        </div>
        <div className="space-y-2 text-xs leading-relaxed">
          <p>
            <strong className="text-cream">Prototype with demo data.</strong> Every price, market cap, volume, holder
            count and chart on this site is simulated. Nothing is live, nothing is tradeable, and no token has been
            deployed.
          </p>
          <p>
            Property tokens are independent digital assets. Holding one does not give legal ownership of any building,
            rental income, or rights to any in-game property.
          </p>
          <p>
            Fan-made concept inspired by open-world crime games. Not affiliated with or endorsed by Rockstar Games or
            Take-Two Interactive. All artwork on this site is original.
          </p>
          <p className="flex gap-4 pt-2 font-bold text-cream">
            <Link href="/about" className="hover:text-tangerine">About</Link>
            <Link href="/markets" className="hover:text-tangerine">Markets</Link>
            <Link href="/?view=map" className="hover:text-tangerine">Map</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
