"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DYNASTY_HQ } from "@/data/dynasty-hq";
import { formatPrice, formatUsdCompact, shortAddress } from "@/lib/format";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import type { EcosystemToken } from "@/lib/types";
import { CategoryBand } from "./listing-card";

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
      <div className={cn("relative shrink-0 overflow-hidden rounded-t-2xl bg-d8-green", compact ? "h-36" : "h-52")}>
        <Image
          src={DYNASTY_HQ.image}
          alt="The DYNASTY Main Office: a marble and glass tower with a gold entrance"
          fill
          sizes="(max-width: 1024px) 100vw, 380px"
          className="object-cover"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-white/95 text-[#212529] backdrop-blur hover:bg-white/95 hover:text-[#212529]"
        >
          <X className="size-4" />
        </button>
        <CategoryBand className="py-1 text-[19px]">Headquarters</CategoryBand>
        <div className="absolute top-2.5 left-3 flex flex-wrap gap-1.5">
          {/* The live badge keeps its solid green; only the pale badges get a white backing over the photo. */}
          <TokenStatusBadge status={token.status} className={token.status === "live" ? undefined : "bg-white/95 backdrop-blur"} />
        </div>
      </div>

      <div className="space-y-4 p-5 pt-3">
        <header>
          <p className="text-[15px] tracking-[0.06em] text-d8-green uppercase">Main office</p>
          <h2 className="mt-1 text-[28px] leading-tight font-bold text-d8-ink">{DYNASTY_HQ.name}</h2>
          <p className="mt-1.5 flex items-center gap-1 text-[16px] text-[#444]">
            <MapPin className="size-3.5" /> {DYNASTY_HQ.area}
          </p>
        </header>

        {!compact && (
          <p className="text-[16px] leading-relaxed text-[#444]">
            Head office of DYNASTY and home of {ticker}, the token behind all 15 properties. Creator fees from every
            property token fund buybacks that burn {ticker}.
          </p>
        )}

        <section className="border-2 border-d8-green bg-d8-mint-soft p-3.5" aria-label={`${ticker} market`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[20px] leading-none font-bold text-d8-ink uppercase">{ticker}</p>
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

        <div className="flex flex-col gap-2">
          <Link
            href="/fund"
            className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full bg-d8-green px-5 text-[15px] tracking-[0.02em] text-white uppercase transition-colors hover:bg-d8-green-dark"
          >
            Demolition Fund <ArrowRight className="size-4 shrink-0" />
          </Link>
          {tradeUrl ? (
            <a
              href={tradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full border-2 border-d8-green bg-white px-5 text-[15px] tracking-[0.02em] text-d8-green uppercase transition-colors hover:bg-d8-mint-soft"
            >
              Trade {ticker} <ExternalLink className="size-4 shrink-0" />
            </a>
          ) : (
            <span className="inline-flex h-11 min-w-0 items-center justify-center rounded-full border-2 border-dashed border-[#cfcfcf] px-4 text-[13px] tracking-[0.04em] text-[#777] uppercase">
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
    <div className="border border-[#dbe6de] bg-white px-2.5 py-2">
      <dt className="text-[10px] tracking-[0.06em] text-[#777] uppercase">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-bold text-d8-ink tabular-nums">{value}</dd>
    </div>
  );
}
