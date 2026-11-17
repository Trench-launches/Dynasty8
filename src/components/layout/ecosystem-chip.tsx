"use client";

import { ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChangeText, MarketDataTag, TokenStatusBadge } from "@/components/property/badges";
import { LogoMark } from "@/components/brand/logo";
import { formatPrice, formatUsdCompact, shortAddress } from "@/lib/format";
import type { EcosystemToken } from "@/lib/types";

/** Compact native-token summary for the header. Deliberately small — the map stays the focus. */
export function EcosystemChip({ token }: { token: EcosystemToken }) {
  const m = token.market;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-full border border-[#ced4da] bg-[#e9ecef] pr-3.5 pl-1.5 text-sm transition-colors outline-none hover:bg-[#e9ecef] focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
          aria-label={`${token.ticker} ecosystem token details`}
        >
          <LogoMark className="size-6" />
          <span className="font-bold text-[#212529]">${token.ticker}</span>
          {m && (
            <span className="hidden text-xs text-cream/60 lg:inline">
              {formatPrice(m.priceUsd)} <ChangeText value={m.change24hPct} />
            </span>
          )}
          <MarketDataTag market={m} className="hidden lg:inline" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border border-[#dee2e6] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-2xl leading-none tracking-wide">
              {token.name} <span className="text-sunset-gradient">${token.ticker}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">DYNASTY ecosystem token</p>
          </div>
          <TokenStatusBadge status={token.status} />
        </div>

        <p className="mt-3 text-sm leading-relaxed text-cream/75">{token.summary}</p>

        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <Stat label="Price" value={formatPrice(m?.priceUsd)} />
          <Stat label="Market cap" value={formatUsdCompact(m?.marketCapUsd)} />
          <Stat label="24h" value={<ChangeText value={m?.change24hPct} />} />
          <Stat label="Volume 24h" value={formatUsdCompact(m?.volume24hUsd)} />
        </dl>
        {m?.source === "demo" && (
          <p className="mt-2 text-[11px] text-neon">Demo figures for design preview — not real market data.</p>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#dee2e6] pt-3 text-xs">
          <span className="text-cream/50">
            Mint: {token.mint && token.mintVerified ? shortAddress(token.mint) : "pending verification"}
          </span>
          {token.pumpFunUrl && token.mintVerified ? (
            <a
              href={token.pumpFunUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-tropic hover:underline"
            >
              Trade <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="text-cream/40">Trading link pending</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[#f8f9fa] px-2.5 py-2">
      <dt className="text-[10px] tracking-wider text-cream/45 uppercase">{label}</dt>
      <dd className="mt-0.5 font-semibold text-cream tabular-nums">{value}</dd>
    </div>
  );
}
