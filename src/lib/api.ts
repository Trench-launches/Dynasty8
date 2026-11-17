import { mockApi } from "@/lib/mock-api";
import type {
  ChartPoint,
  ChartRange,
  EcosystemMarkets,
  EcosystemToken,
  MarketSnapshot,
  Property,
} from "@/lib/types";

/**
 * Central API client. Every component gets data through here — never import
 * mock data directly into UI code.
 *
 * Set NEXT_PUBLIC_API_BASE_URL (e.g. https://api.dynasty8.example) to talk to the
 * real backend. Leave it unset to use the in-memory mock in src/lib/mock-api.ts.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

export const usingMockApi = API_BASE === "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}`);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, init?: { allow404?: boolean }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (res.status === 404 && init?.allow404) return null as T;
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  getProperties(): Promise<Property[]> {
    return usingMockApi ? mockApi.getProperties() : get("/api/properties");
  },
  getProperty(slug: string): Promise<Property | null> {
    return usingMockApi
      ? mockApi.getProperty(slug)
      : get(`/api/properties/${enc(slug)}`, { allow404: true });
  },
  getPropertyMarket(slug: string): Promise<MarketSnapshot | null> {
    return usingMockApi
      ? mockApi.getPropertyMarket(slug)
      : get(`/api/properties/${enc(slug)}/market`, { allow404: true });
  },
  getPropertyChart(slug: string, range: ChartRange): Promise<ChartPoint[]> {
    return usingMockApi
      ? mockApi.getPropertyChart(slug, range)
      : get(`/api/properties/${enc(slug)}/chart?range=${range}`);
  },
  getEcosystem(): Promise<EcosystemToken> {
    return usingMockApi ? mockApi.getEcosystem() : get("/api/ecosystem");
  },
  getEcosystemMarkets(): Promise<EcosystemMarkets> {
    return usingMockApi ? mockApi.getEcosystemMarkets() : get("/api/ecosystem/markets");
  },
};
