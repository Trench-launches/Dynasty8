import { Keypair } from "@solana/web3.js";
import { PrismaClient, type AdminRole } from "@prisma/client";
import { seed } from "../../prisma/seed";
import { appCache } from "@/server/cache";
import { adminApiLimiter, providerBudgets, publicApiLimiter } from "@/server/http/rate-limit";
import { setProvidersForTests, type Providers } from "@/server/providers/registry";
import type { MarketQuote } from "@/server/providers/types";
import type { MintInfo, PumpCurveInfo } from "@/server/solana/rpc";
import { setSessionResolverForTests } from "@/server/auth/admin";

export const BASE = "http://localhost:3530";

let client: PrismaClient | null = null;
export function db() {
  client ??= new PrismaClient();
  return client;
}

/** Wipes every table and re-applies the seed. */
export async function resetDatabase() {
  const p = db();
  await p.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "MarketSnapshot", "SourceReference", "Token", "Property", "AdminUser" RESTART IDENTITY CASCADE',
  );
  await seed(p);
  appCache.clear();
  publicApiLimiter.reset();
  adminApiLimiter.reset();
  Object.values(providerBudgets).forEach((b) => b.reset());
}

/** Freshly generated, syntactically valid keys. Test-only; never written by the seed. */
export const newKey = () => Keypair.generate().publicKey.toBase58();

export interface MockState {
  mints: Map<string, MintInfo>;
  curves: Map<string, PumpCurveInfo>;
  quotes: Map<string, MarketQuote>;
  marketError: Error | null;
  metadata: Map<string, { name: string | null; symbol: string | null }>;
  chart: Providers["charts"][number]["getCandles"] | null;
}

export function installMockProviders(): MockState {
  const state: MockState = { mints: new Map(), curves: new Map(), quotes: new Map(), marketError: null, metadata: new Map(), chart: null };
  setProvidersForTests({
    solana: {
      async getMintInfo(m) {
        return state.mints.get(m) ?? { exists: false, program: null, supply: null, decimals: null, mintAuthority: null, freezeAuthority: null };
      },
      async getPumpCurve(m) {
        return state.curves.get(m) ?? { exists: false, complete: null };
      },
    },
    market: [
      {
        name: "mock-market",
        async getQuotes(mints) {
          if (state.marketError) throw state.marketError;
          return new Map(mints.filter((m) => state.quotes.has(m)).map((m) => [m, state.quotes.get(m)!]));
        },
      },
    ],
    charts: [
      {
        name: "mock-chart",
        async getCandles(input) {
          return state.chart ? state.chart(input) : null;
        },
      },
    ],
    metadata: {
      name: "mock-metadata",
      async getMetadata(m) {
        const md = state.metadata.get(m);
        return md ? { source: "mock-metadata", name: md.name, symbol: md.symbol, imageUrl: null, supply: null, decimals: null } : null;
      },
    },
  });
  return state;
}

export function validMint(supply = "1000000000000000", decimals = 6): MintInfo {
  return { exists: true, program: "TOKEN", supply, decimals, mintAuthority: null, freezeAuthority: null };
}

export function quote(partial: Partial<MarketQuote> = {}): MarketQuote {
  return {
    source: "mock-market",
    priceUsd: 0.0005,
    priceSol: 0.000003,
    marketCapUsd: 500_000,
    fdvUsd: 500_000,
    volume24hUsd: 42_000,
    change24hPct: 4.2,
    liquidityUsd: 30_000,
    pairAddress: newKey(),
    dexId: "pumpswap",
    lastTradeAt: null,
    ...partial,
  };
}

/** Signs a test admin "in" by GitHub id. */
export async function signInAs(role: AdminRole | null, opts: { active?: boolean } = {}) {
  if (role === null) {
    setSessionResolverForTests(async () => null);
    return null;
  }
  const githubId = String(100000 + Math.floor(Math.random() * 1e6));
  const admin = await db().adminUser.create({ data: { githubId, login: `test-${role.toLowerCase()}`, role, active: opts.active ?? true } });
  setSessionResolverForTests(async () => githubId);
  return admin;
}

export function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, { headers: { "x-forwarded-for": "10.0.0.1", ...headers } });
}

export function send(method: "POST" | "PATCH", path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "10.0.0.2", ...headers },
    body: JSON.stringify(body),
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** Makes a seeded property's token LIVE with a mint, directly in the DB (for read-path tests). */
export async function makeLive(slug: string, mint = newKey()) {
  const p = await db().property.findUniqueOrThrow({ where: { slug }, include: { token: true } });
  await db().token.update({
    where: { id: p.token!.id },
    data: { mintAddress: mint, deploymentStatus: "LIVE", metadataStatus: "VERIFIED", pumpFunUrl: `https://pump.fun/coin/${mint}` },
  });
  return { tokenId: p.token!.id, mint };
}

export async function addSnapshot(tokenId: string, ageMs: number, partial: Partial<MarketQuote> = {}) {
  const q = quote(partial);
  return db().marketSnapshot.create({
    data: {
      tokenId,
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
      fetchedAt: new Date(Date.now() - ageMs),
    },
  });
}
