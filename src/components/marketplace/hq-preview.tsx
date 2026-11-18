"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ExternalLink, Landmark, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DYNASTY_HQ } from "@/data/dynasty-hq";
import { formatPrice, formatUsdCompact, shortAddress } from "@/lib/format";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import type { EcosystemToken } from "@/lib/types";

interface HqPreviewProps {
  token: EcosystemToken;
  onClose: () => void;
  compact?: boolean;
}

/**
 * Details for the DYNASTY Main Office landmark: the $DYNASTY token, shown in the same slot and
 * style as a property preview (right panel on desktop, bottom sheet on mobile).
 */
export function HqPreview({ token, onClose, compact = false }: HqPreviewProps) {
  const m = token.market;
  const tradeUrl = token.mintVerified ? token.pumpFunUrl : null;
  const ticker = `$${token.ticker}`;

  return (
    <article className="flex flex-col" aria-label={`${DYNASTY_HQ.name} details`}>
      <div
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-t-2xl bg-d8-green",
          compact ? "h-36" : "h-52",
        )}
      >
        <Image
          src="/brand/dynasty15-logo.png"
          alt="DYNASTY 15"
          width={1024}
          height={515}
          sizes="240px"
          className={cn("h-auto", compact ? "w-40" : "w-56")}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-white/95 text-[#212529] backdrop-blur hover:bg-white/95 hover:text-[#212529]"
        >
          <X className="size-4" />
        </button>
        <div className="absolute bottom-2.5 left-3 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded bg-[#e0b13a] px-2 py-0.5 text-[10px] font-semibold tracking-wider text-[#212529] uppercase">
            <Landmark className="size-3" /> Headquarters
          </span>
          {/* The live badge keeps its solid green; only the pale badges get a white backing over the photo. */}
          <TokenStatusBadge status={token.status} className={token.status === "live" ? undefined : "bg-white/95 backdrop-blur"} />
        </div>
      </div>

      <div className="space-y-4 p-5 pt-3">
        <header>
          <p className="font-display text-[15px] font-semibold tracking-[0.08em] text-mint uppercase">Main office</p>
          <h2 className="mt-1 font-display text-[26px] leading-tight font-semibold text-cream">{DYNASTY_HQ.name}</h2>
          <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-[#495057]">
            <MapPin className="size-3.5" /> {DYNASTY_HQ.area}
          </p>
        </header>

        {!compact && (
          <p className="text-[15px] leading-snug font-semibold text-[#212529]">
            Head office of DYNASTY and home of {ticker}, the token behind all 15 properties. Creator fees from every
            property token fund buybacks that burn {ticker}.
          </p>
        )}

        <section className="rounded-2xl border border-[#dee2e6] bg-[#f8f9fa] p-3.5" aria-label={`${ticker} market`}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-[22px] leading-none font-semibold text-lime">{ticker}</p>
            <MarketDataTag market={m} />
          </div>
          {m ? (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Stat label="Price" value={formatPrice(m.priceUsd)} />
              <Stat label="Market cap" value={formatUsdCompact(m.marketCapUsd)} />
              <Stat label="24h change" value={<ChangeText value={m.change24hPct} />} />
              <Stat label="24h volume" value={formatUsdCompact(m.volume24hUsd)} />
            </dl>
          ) : (
            <p className="mt-2 text-sm text-[#6c757d]">
              {token.status === "unavailable"
                ? "This token is currently unavailable."
                : `Market data appears once ${ticker} launches on Pump.fun.`}
            </p>
          )}
          <p className="mt-3 text-[11px] text-[#868e96]">
            Mint:{" "}
            {token.mint && token.mintVerified ? (
              <span className="font-mono">{shortAddress(token.mint)}</span>
            ) : (
              "pending verification"
            )}
          </p>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/fund"
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded bg-lime px-4 text-[14px] font-bold whitespace-nowrap text-ink transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Demolition Fund <ArrowRight className="size-4 shrink-0" />
          </Link>
          {tradeUrl ? (
            <a
              href={tradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded bg-blush px-4 text-[14px] font-bold whitespace-nowrap text-ink transition-transform hover:scale-[1.02]"
            >
              Trade {ticker} <ExternalLink className="size-4 shrink-0" />
            </a>
          ) : (
            <span className="inline-flex h-11 flex-1 items-center justify-center rounded border-[1.5px] border-dashed border-[#ced4da] px-4 text-xs font-bold whitespace-nowrap text-[#6c757d]">
              Trading link pending
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#f8f9fa] px-2.5 py-2">
      <dt className="text-[10px] tracking-wider text-[#868e96] uppercase">{label}</dt>
      <dd className="mt-0.5 font-semibold text-[#212529] tabular-nums">{value}</dd>
    </div>
  );
}
