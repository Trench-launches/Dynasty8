import Link from "next/link";
import { PROPERTIES, ECOSYSTEM_TOKEN } from "@/data/properties";
import { formatPct, formatPrice } from "@/lib/utils";

/** Scrolling ticker of demo prices, clearly labelled as demo. */
export function TokenTape() {
  const items = [
    { ticker: ECOSYSTEM_TOKEN.market.ticker, price: ECOSYSTEM_TOKEN.market.priceUsd, ch: ECOSYSTEM_TOKEN.market.change24hPct, href: "/markets#realty" },
    ...PROPERTIES.map((p) => ({
      ticker: p.market.ticker,
      price: p.market.priceUsd,
      ch: p.market.change24hPct,
      href: `/property/${p.slug}`,
    })),
  ];
  const row = (dup: boolean) =>
    items.map((i) => (
      <Link
        key={`${dup}-${i.ticker}`}
        href={i.href}
        tabIndex={dup ? -1 : undefined}
        aria-hidden={dup || undefined}
        className="flex shrink-0 items-center gap-2 px-4 text-xs font-bold hover:text-tangerine"
      >
        <span className="text-cream">${i.ticker}</span>
        <span className="tabular-nums text-cream/60">{formatPrice(i.price)}</span>
        <span className={i.ch >= 0 ? "text-[#5ff0c0]" : "text-[#ff8aa0]"}>{formatPct(i.ch)}</span>
      </Link>
    ));
  return (
    <div className="relative flex h-8 items-center overflow-hidden bg-midnight text-cream">
      <span className="bg-sunset z-10 flex h-full shrink-0 items-center px-3 text-[10px] font-extrabold uppercase tracking-widest text-white">
        Demo prices
      </span>
      <div className="group relative flex-1 overflow-hidden">
        <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}
