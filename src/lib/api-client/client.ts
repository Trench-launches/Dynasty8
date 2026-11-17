/**
 * Typed client for the public backend API. Safe for client and server components.
 * Base URL: NEXT_PUBLIC_API_BASE_URL (empty = same origin, the default when the API runs
 * inside this Next.js app).
 */
import type {
  ApiErrorDto,
  ChartDto,
  ChartRange,
  EcosystemDto,
  EcosystemMarketRowDto,
  MarketDto,
  Paginated,
  PropertyCategory,
  PropertyDetailDto,
  PropertySummaryDto,
  LocationVerification,
  TokenDto,
} from "@/contracts/api";
import type { FundHistoryDto } from "@/contracts/demolition-fund";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorDto["error"]["code"] | "NETWORK",
    message: string,
  ) {
    super(message);
  }
}

export interface ListPropertiesParams {
  page?: number;
  pageSize?: number;
  q?: string;
  category?: PropertyCategory;
  region?: string;
  verification?: LocationVerification;
  featured?: boolean;
  sort?: "name" | "featured" | "marketCap" | "volume" | "change24h";
  order?: "asc" | "desc";
}

const base = () => (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit & { fetchImpl?: typeof fetch }): Promise<T> {
  const f = init?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${base()}${path}`, { ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch {
    throw new ApiClientError(0, "NETWORK", "Could not reach the API");
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiErrorDto | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? "INTERNAL", err?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const api = {
  listProperties: (p: ListPropertiesParams = {}, init?: RequestInit) =>
    request<Paginated<PropertySummaryDto>>(`/api/properties${qs(p)}`, init),
  getProperty: (slug: string, init?: RequestInit) =>
    request<PropertyDetailDto>(`/api/properties/${encodeURIComponent(slug)}`, init),
  getPropertyMarket: (slug: string, init?: RequestInit) =>
    request<{ slug: string; token: TokenDto | null; market: MarketDto }>(`/api/properties/${encodeURIComponent(slug)}/market`, init),
  getPropertyChart: (slug: string, range: ChartRange = "24h", init?: RequestInit) =>
    request<ChartDto>(`/api/properties/${encodeURIComponent(slug)}/chart${qs({ range })}`, init),
  getEcosystem: (init?: RequestInit) => request<EcosystemDto>("/api/ecosystem", init),
  getEcosystemMarkets: (init?: RequestInit) => request<{ items: EcosystemMarketRowDto[] }>("/api/ecosystem/markets", init),
  getFundHistory: (p: { limit?: number; before?: string } = {}, init?: RequestInit) =>
    request<FundHistoryDto>(`/api/demolition-fund/history${qs(p)}`, init),
};
