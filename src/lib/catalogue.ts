import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { usingMockApi } from "@/lib/api";
import { mockApi } from "@/lib/mock-api";
import { toEcosystemMarkets, toEcosystemToken, toProperty } from "@/lib/api-client/adapter";
import { ApiError } from "@/server/http/responses";
import { getEcosystem } from "@/server/services/ecosystem";
import { getProperty, listAllProperties } from "@/server/services/properties";
import type { EcosystemMarkets, EcosystemToken, Property } from "@/lib/types";

/**
 * Server-side reads for pages. They call the backend services directly (no HTTP round trip
 * to this app's own API) and convert the DTOs with the same adapter the browser client uses.
 *
 * Database reads happen at request time: `connection()` keeps them out of the build, so
 * `next build` never needs a database. Each read runs at most once per request (React `cache`),
 * and a server instance reuses a result for SHARED_MS, so a burst of visitors shares one database
 * read (this keeps the Cloudflare Worker inside the free plan's CPU allowance). Live market numbers
 * are refreshed client-side. Next.js Cache Components ("use cache") stays off because it does not
 * yet run reliably on Cloudflare.
 */

const SHARED_MS = 30_000;

/**
 * Keeps the last loaded value for SHARED_MS within this server instance. Only settled values are
 * shared: a Cloudflare Worker must not await I/O that another request started. Treat the value as
 * read-only (it is handed to every request in the window).
 */
function shared<K, T>(load: (key: K) => Promise<T>) {
  const hits = new Map<K, { value: T; at: number }>();
  return async (key: K): Promise<T> => {
    const hit = hits.get(key);
    if (hit && Date.now() - hit.at < SHARED_MS) return hit.value;
    const value = await load(key);
    hits.set(key, { value, at: Date.now() });
    return value;
  };
}

export async function getCatalogue(): Promise<Property[]> {
  if (usingMockApi) return mockApi.getProperties();
  await connection();
  return dbCatalogue();
}

export async function getCatalogueProperty(slug: string): Promise<Property | null> {
  if (usingMockApi) return mockApi.getProperty(slug);
  await connection();
  return dbProperty(slug);
}

export async function getEcosystemToken(): Promise<EcosystemToken> {
  if (usingMockApi) return mockApi.getEcosystem();
  await connection();
  return toEcosystemToken(await dbEcosystem());
}

export async function getEcosystemMarkets(): Promise<EcosystemMarkets> {
  if (usingMockApi) return mockApi.getEcosystemMarkets();
  await connection();
  return toEcosystemMarkets(await dbEcosystem());
}

const sharedCatalogue = shared(async () => (await listAllProperties()).map(toProperty));
const dbCatalogue = cache(() => sharedCatalogue(null));

const sharedProperty = shared(async (slug: string) => {
  try {
    return toProperty(await getProperty(slug));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
});
const dbProperty = cache((slug: string) => sharedProperty(slug));

const sharedEcosystem = shared(() => getEcosystem());
const dbEcosystem = cache(() => sharedEcosystem(null));
