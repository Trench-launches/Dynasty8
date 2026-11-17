import "server-only";
import { cacheLife } from "next/cache";
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
 * Database reads always happen per request: `connection()` keeps them out of the build, so
 * `next build` never needs a database. Results are cached for a few seconds ("seconds"
 * profile) to absorb traffic; live market numbers are then refreshed client-side.
 */

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

async function dbCatalogue() {
  "use cache";
  cacheLife("seconds");
  return (await listAllProperties()).map(toProperty);
}

async function dbProperty(slug: string) {
  "use cache";
  cacheLife("seconds");
  try {
    return toProperty(await getProperty(slug));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

async function dbEcosystem() {
  "use cache";
  cacheLife("seconds");
  return getEcosystem();
}
