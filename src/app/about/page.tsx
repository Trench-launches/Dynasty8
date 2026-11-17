import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Home, Map, ShieldAlert } from "lucide-react";
import { brand } from "@/config/brand";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "About" };

const STEPS = [
  {
    icon: Map,
    title: "Browse the city",
    body: "Explore listings on an interactive map of a fictional sun-soaked city. Every marker is a property with its own token.",
  },
  {
    icon: Home,
    title: "One property, one token",
    body: "Each listing will launch as an independent token on Pump.fun, with its own market, price and holders.",
  },
  {
    icon: Coins,
    title: "REALTY ties it together",
    body: "A native ecosystem token connects the marketplace. It does not represent or back any individual property token.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8 lg:px-6">
      <section className="bg-sunset overflow-hidden rounded-[2rem] p-7 text-white sm:p-10">
        <p className="text-xs font-extrabold uppercase tracking-[0.3em] text-white/80">About {brand.name}</p>
        <h1 className="mt-2 font-display text-4xl leading-tight tracking-wide sm:text-5xl">
          The in-game property site,
          <br />
          rebuilt for the sunset era.
        </h1>
        <p className="mt-4 max-w-2xl text-white/90">
          {brand.name} is a concept for a property token marketplace on Solana, styled after the real estate websites
          of open-world crime games and painted in a Vice City sunset palette.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-3xl bg-white p-5 ring-1 ring-violet/8">
            <span className="bg-sunset grid h-11 w-11 place-items-center rounded-2xl text-white">
              <Icon className="size-5" aria-hidden />
            </span>
            <h2 className="mt-3 font-display text-xl tracking-wide text-violet">{title}</h2>
            <p className="mt-1 text-sm text-violet/75">{body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-3xl bg-white p-6 ring-1 ring-violet/8">
        <h2 className="flex items-center gap-2 font-display text-2xl tracking-wide text-violet">
          <ShieldAlert className="size-6 text-coral" aria-hidden /> What this prototype is, and is not
        </h2>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-violet/80">
          <li>
            <strong>Frontend only.</strong> There is no backend, no database, no smart contract and no wallet signing.
          </li>
          <li>
            <strong>Demo data everywhere.</strong> Prices, market caps, volumes, holder counts, bonding-curve progress
            and charts are simulated and labelled as demo.
          </li>
          <li>
            <strong>No trading.</strong> No token has been deployed. Trade buttons are disabled and marked Coming soon.
          </li>
          <li>
            <strong>No property rights.</strong> Property tokens are independent digital assets. Holding one does not
            give legal ownership of any building, any rental income, or rights to any in-game property.
          </li>
          <li>
            <strong>Fan concept.</strong> Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. The
            map, logo and property artwork are original.
          </li>
        </ul>
        <Link href="/" className={buttonVariants({ className: "mt-6" })}>
          Explore the map
        </Link>
      </section>
    </div>
  );
}
