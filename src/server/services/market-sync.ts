import "server-only";
import type { TradingVenue } from "@prisma/client";
import { prisma } from "@/server/db";
import { ProviderError } from "@/server/http/fetch-json";
import { logger } from "@/server/logger";
import { getProviders } from "@/server/providers/registry";
import type { MarketQuote } from "@/server/providers/types";
import { recordAudit, SYSTEM_ACTOR } from "./audit";

export interface SyncResult {
  tokens: number;
  snapshots: number;
  missing: string[];
  provider: string | null;
  error: string | null;
}

function venueFromDex(dexId: string | null): TradingVenue | null {
  if (dexId === "pumpfun") return "PUMPFUN_BONDING_CURVE";
  if (dexId === "pumpswap") return "PUMPSWAP";
  return dexId ? "OTHER_DEX" : null;
}

/**
 * Polls providers for every LIVE token (property tokens and the native token) and stores
 * one snapshot per token that the provider actually reported. Tokens the provider did not
 * return get no row, so their data ages into STALE / UNAVAILABLE instead of being faked.
 * Public API requests never trigger provider calls; only this job does.
 */
export async function syncMarkets(): Promise<SyncResult> {
  const tokens = await prisma.token.findMany({
    where: { deploymentStatus: "LIVE", mintAddress: { not: null } },
    select: { id: true, mintAddress: true, venue: true },
  });
  const mints = tokens.map((t) => t.mintAddress!) ;
  const result: SyncResult = { tokens: tokens.length, snapshots: 0, missing: [], provider: null, error: null };
  if (!mints.length) return result;

  let quotes: Map<string, MarketQuote> | null = null;
  for (const provider of getProviders().market) {
    try {
      quotes = await provider.getQuotes(mints);
      result.provider = provider.name;
      break;
    } catch (e) {
      result.error = e instanceof ProviderError ? e.kind : "unknown";
      logger.warn({ provider: provider.name, kind: result.error }, "market provider failed");
    }
  }
  if (!quotes) return result;
  result.error = null;

  const fetchedAt = new Date();
  for (const t of tokens) {
    const q = quotes.get(t.mintAddress!);
    if (!q) {
      result.missing.push(t.mintAddress!);
      continue;
    }
    await prisma.marketSnapshot.create({
      data: {
        tokenId: t.id,
        source: q.source,
        priceUsd: q.priceUsd,
        priceSol: q.priceSol,
        marketCapUsd: q.marketCapUsd,
        fdvUsd: q.fdvUsd,
        volume24hUsd: q.volume24hUsd,
        change24hPct: q.change24hPct,
        liquidityUsd: q.liquidityUsd,
        pairAddress: q.pairAddress,
        dexId: q.dexId,
        lastTradeAt: q.lastTradeAt,
        fetchedAt,
      },
    });
    result.snapshots++;

    // Venue change detection (e.g. bonding curve -> PumpSwap after migration).
    const venue = venueFromDex(q.dexId);
    if (venue && venue !== t.venue) {
      await prisma.$transaction(async (tx) => {
        await tx.token.update({ where: { id: t.id }, data: { venue } });
        await recordAudit(tx, SYSTEM_ACTOR, "token.venue_changed", "Token", t.id, { venue: t.venue }, { venue, dexId: q.dexId });
      });
    }
  }
  return result;
}

/** Keeps the snapshot table bounded. */
export async function pruneSnapshots(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const { count } = await prisma.marketSnapshot.deleteMany({ where: { fetchedAt: { lt: cutoff } } });
  return count;
}
