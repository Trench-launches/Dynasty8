import { mockApi } from "@/lib/mock-api";
import { ApiClientError, api as backend } from "@/lib/api-client/client";
import {
  toChartPoints,
  toEcosystemMarkets,
  toEcosystemToken,
  toMarketSnapshot,
  toProperty,
} from "@/lib/api-client/adapter";
import type {
  ChartPoint,
  ChartRange,
  EcosystemMarkets,
  EcosystemToken,
  MarketSnapshot,
  Property,
} from "@/lib/types";

/**
 * Browser-side data client. Every client component gets data through here — never import
 * mock data directly into UI code. Server components use src/lib/catalogue.ts instead, which
 * reads the database directly rather than calling this app's own HTTP API.
 *
 * Default: the real backend (the /api routes in this app, or NEXT_PUBLIC_API_BASE_URL).
 * NEXT_PUBLIC_MOCK_API=true: the in-memory mock in src/lib/mock-api.ts (no database needed).
 */

export const usingMockApi = process.env.NEXT_PUBLIC_MOCK_API === "true";

export { ApiClientError };

async function nullOn404<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) return null;
    throw e;
  }
}

/** The list endpoint is paginated (max 50); the map needs every listing. */
async function listAll(): Promise<Property[]> {
  const out: Property[] = [];
  for (let page = 1; ; page++) {
    const res = await backend.listProperties({ page, pageSize: 50 });
    out.push(...res.items.map(toProperty));
    if (page >= res.totalPages) return out;
  }
}

export const api = {
  getProperties(): Promise<Property[]> {
    return usingMockApi ? mockApi.getProperties() : listAll();
  },
  async getProperty(slug: string): Promise<Property | null> {
    if (usingMockApi) return mockApi.getProperty(slug);
    const dto = await nullOn404(backend.getProperty(slug));
    return dto ? toProperty(dto) : null;
  },
  async getPropertyMarket(slug: string): Promise<MarketSnapshot | null> {
    if (usingMockApi) return mockApi.getPropertyMarket(slug);
    const res = await nullOn404(backend.getPropertyMarket(slug));
    return res ? toMarketSnapshot(res.market) : null;
  },
  async getPropertyChart(slug: string, range: ChartRange): Promise<ChartPoint[]> {
    if (usingMockApi) return mockApi.getPropertyChart(slug, range);
    return toChartPoints(await backend.getPropertyChart(slug, range));
  },
  async getEcosystem(): Promise<EcosystemToken> {
    if (usingMockApi) return mockApi.getEcosystem();
    return toEcosystemToken(await backend.getEcosystem());
  },
  async getEcosystemMarkets(): Promise<EcosystemMarkets> {
    if (usingMockApi) return mockApi.getEcosystemMarkets();
    return toEcosystemMarkets(await backend.getEcosystem());
  },
};
