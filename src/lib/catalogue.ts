import { cacheLife } from "next/cache";
import { api } from "@/lib/api";

/**
 * Server-side cached reads used by pages for the prerendered shell.
 * Live market numbers are refreshed client-side on top of this.
 */

export async function getCatalogue() {
  "use cache";
  cacheLife("minutes");
  return api.getProperties();
}

export async function getCatalogueProperty(slug: string) {
  "use cache";
  cacheLife("minutes");
  return api.getProperty(slug);
}

export async function getEcosystemToken() {
  "use cache";
  cacheLife("minutes");
  return api.getEcosystem();
}

export async function getEcosystemMarkets() {
  "use cache";
  cacheLife("minutes");
  return api.getEcosystemMarkets();
}
