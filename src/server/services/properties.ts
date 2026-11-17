import "server-only";
import type { Prisma } from "@prisma/client";
import type { Paginated, PropertyDetailDto, PropertySummaryDto } from "@/contracts/api";
import { prisma } from "@/server/db";
import { getConfig } from "@/server/config";
import { ApiError } from "@/server/http/responses";
import type { ListPropertiesQuery } from "@/server/api/schemas";
import { toPropertyDetail, toPropertySummary } from "./mappers";

/** Latest snapshot only; enough for list/detail market fields. */
export const tokenInclude = {
  token: { include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } } },
} satisfies Prisma.PropertyInclude;

type MetricKey = "marketCapUsd" | "volume24hUsd" | "change24hPct";

/**
 * Public listing: PUBLISHED properties only. Filtering happens in SQL; market-based sorts
 * happen in memory over the filtered set (the catalogue is tens of rows, not millions;
 * see docs/BACKEND.md for the materialised-column plan if that changes).
 * Properties without market data always sort last, whatever the direction.
 */
export async function listProperties(q: ListPropertiesQuery): Promise<Paginated<PropertySummaryDto>> {
  const { MARKET_STALE_AFTER_MS } = getConfig();
  const where: Prisma.PropertyWhereInput = { status: "PUBLISHED" };
  if (q.category) where.category = q.category;
  if (q.verification) where.locationVerification = q.verification;
  if (q.featured !== undefined) where.featured = q.featured;
  if (q.region) where.region = { equals: q.region, mode: "insensitive" };
  if (q.q) {
    const term = q.q.replace(/^\$/, "");
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { proposedTicker: { equals: term.toUpperCase() } },
      { token: { ticker: { equals: term.toUpperCase() } } },
    ];
  }

  const rows = await prisma.property.findMany({ where, include: tokenInclude, orderBy: { name: "asc" } });
  const now = Date.now();
  let items = rows.map((r) => toPropertySummary(r, now, MARKET_STALE_AFTER_MS));

  const metric: Record<string, MetricKey | undefined> = {
    marketCap: "marketCapUsd",
    volume: "volume24hUsd",
    change24h: "change24hPct",
  };
  const key = metric[q.sort];
  if (key) {
    const dir = q.order === "asc" ? 1 : -1;
    items = items.sort((a, b) => {
      const va = a.market.freshness === "UNAVAILABLE" ? null : a.market[key];
      const vb = b.market.freshness === "UNAVAILABLE" ? null : b.market[key];
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va - vb) * dir || a.name.localeCompare(b.name);
    });
  } else if (q.sort === "featured") {
    items = items.sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
  } else if (q.order === "desc") {
    items = items.reverse();
  }

  const total = items.length;
  const start = (q.page - 1) * q.pageSize;
  return {
    items: items.slice(start, start + q.pageSize),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/**
 * Every published listing, unpaginated, in launch order. Used by server-rendered pages,
 * which read the database directly instead of calling this app's own HTTP API.
 */
export async function listAllProperties(): Promise<PropertySummaryDto[]> {
  const { MARKET_STALE_AFTER_MS } = getConfig();
  const rows = await prisma.property.findMany({
    where: { status: "PUBLISHED" },
    include: tokenInclude,
    orderBy: { name: "asc" },
  });
  const now = Date.now();
  return rows
    .map((r) => toPropertySummary(r, now, MARKET_STALE_AFTER_MS))
    .sort((a, b) => (a.launchOrder ?? Infinity) - (b.launchOrder ?? Infinity) || a.name.localeCompare(b.name));
}

export async function getPublishedPropertyRow(slug: string) {
  const row = await prisma.property.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: { ...tokenInclude, sources: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) throw new ApiError(404, "NOT_FOUND", "Property not found");
  return row;
}

export async function getProperty(slug: string): Promise<PropertyDetailDto> {
  const row = await getPublishedPropertyRow(slug);
  return toPropertyDetail(row, Date.now(), getConfig().MARKET_STALE_AFTER_MS);
}
