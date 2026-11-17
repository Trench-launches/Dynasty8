import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiErrorDto } from "@/contracts/api";
import { logger } from "@/server/logger";
import type { RateLimiter } from "./rate-limit";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorDto["error"]["code"],
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function json<T>(data: T, init?: { status?: number; cacheSeconds?: number }) {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  headers["cache-control"] = init?.cacheSeconds
    ? `public, max-age=0, s-maxage=${init.cacheSeconds}, stale-while-revalidate=${init.cacheSeconds}`
    : "no-store";
  return NextResponse.json(data, { status: init?.status ?? 200, headers });
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    const body: ApiErrorDto = { error: { code: err.code, message: err.message, details: err.details } };
    return NextResponse.json(body, { status: err.status, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } });
  }
  if (err instanceof ZodError) {
    const body: ApiErrorDto = {
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request",
        details: err.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
    return NextResponse.json(body, { status: 400, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } });
  }
  // Unknown errors: log internally, return a generic message (no stack traces or SQL to clients).
  logger.error({ err }, "unhandled API error");
  const body: ApiErrorDto = { error: { code: "INTERNAL", message: "Internal server error" } };
  return NextResponse.json(body, { status: 500, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } });
}

export function clientIp(req: Request): string {
  // Behind a trusted proxy (Railway, Cloudflare) the first X-Forwarded-For hop is the client.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

export function enforceRateLimit(limiter: RateLimiter, req: Request, group: string) {
  const key = `${group}:${clientIp(req)}`;
  if (!limiter.take(key)) {
    throw new ApiError(429, "RATE_LIMITED", `Too many requests. Retry in ${limiter.resetIn(key)}s.`);
  }
}

/** Wrap a route handler with uniform error handling. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Rejects query parameters that the endpoint does not support. */
export function queryObject(req: Request, allowed: readonly string[]): Record<string, string> {
  const url = new URL(req.url);
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (!allowed.includes(k)) {
      throw new ApiError(400, "BAD_REQUEST", `Unsupported query parameter: ${k.slice(0, 40)}`);
    }
    if (k in out) throw new ApiError(400, "BAD_REQUEST", `Duplicate query parameter: ${k}`);
    out[k] = v;
  }
  return out;
}

/** Parses a JSON body with a size cap and content-type check. */
export async function readJsonBody(req: Request, maxBytes = 64_000): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415 as number, "BAD_REQUEST", "Content-Type must be application/json");
  }
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "BAD_REQUEST", "Request body too large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Malformed JSON body");
  }
}
