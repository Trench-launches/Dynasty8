// Cloudflare entry point: the Next.js app (built by `opennextjs-cloudflare build` into .open-next/)
// behind a short edge cache, plus a scheduled handler that runs the background jobs once a minute
// (see wrangler.jsonc "triggers").
// Bundled by Wrangler, not by Next.js, so it is excluded from the app's tsconfig.
// @ts-expect-error generated at build time
import { default as handler } from "./.open-next/worker.js";

interface Env {
  CRON_SECRET?: string;
  CF_VERSION_METADATA?: { id: string };
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/**
 * Edge cache. Rendering a page or reading the database costs more CPU than the Workers free plan
 * allows per request, so public GET pages and API reads are kept in this data centre's cache for a
 * few seconds: each URL renders at most once per window and every other visitor gets the stored
 * copy, which costs almost nothing. Live prices still refresh in the browser (the API is cached
 * for less time than the client polls).
 *
 * Never cached: anything but GET, admin and auth routes, the internal tick, requests that carry
 * credentials, client-side navigation payloads (RSC requests depend on headers, not just the URL),
 * and any response that is not a plain 200 or that sets a cookie. Keys include the deployed
 * version, so a new deploy never serves pages that point at the previous build's files.
 */
const PAGE_TTL_S = 30;
const API_TTL_S = 15;
const NEVER = ["/admin", "/api/admin", "/api/auth", "/api/internal"];

function ttlFor(req: Request, url: URL): number | null {
  if (req.method !== "GET") return null;
  if (NEVER.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null;
  const h = req.headers;
  if (h.has("authorization") || h.has("rsc") || h.has("next-router-state-tree") || h.has("next-router-prefetch")) return null;
  if (url.searchParams.has("_rsc")) return null;
  if (/authjs|next-auth/i.test(h.get("cookie") ?? "")) return null;
  return url.pathname.startsWith("/api/") ? API_TTL_S : PAGE_TTL_S;
}

async function cachedFetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const ttl = ttlFor(req, url);
  if (ttl === null) return handler.fetch(req, env, ctx);

  const cache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
  const keyUrl = new URL(url);
  keyUrl.searchParams.set("__v", env.CF_VERSION_METADATA?.id ?? "dev");
  const key = new Request(keyUrl.toString(), { method: "GET" });

  try {
    const hit = await cache.match(key);
    if (hit) {
      const out = new Response(hit.body, hit);
      out.headers.set("x-edge-cache", "hit");
      return out;
    }
  } catch (err) {
    // A cache failure must never take the page down; render it instead.
    console.error("edge cache read failed", err);
  }

  const res: Response = await handler.fetch(req, env, ctx);
  if (res.status !== 200 || !res.body || res.headers.has("set-cookie")) return res;

  const [forVisitor, forCache] = res.body.tee();
  const stored = new Response(forCache, res);
  stored.headers.set("cache-control", `public, max-age=${ttl}`);
  // Next.js varies pages on its client-navigation headers; those requests are never cached here,
  // and a Vary header would stop the cache from storing the page at all.
  stored.headers.delete("vary");
  ctx.waitUntil(cache.put(key, stored).catch((err: unknown) => console.error("edge cache write failed", err)));
  const out = new Response(forVisitor, res);
  out.headers.set("x-edge-cache", "miss");
  return out;
}

const worker = {
  fetch: cachedFetch,

  async scheduled(_controller: unknown, env: Env, ctx: Ctx) {
    // The tick route refuses requests without the shared secret; skip quietly until it is set.
    if (!env.CRON_SECRET) return;
    const req = new Request("https://dynasty8.internal/api/internal/tick", {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    const res: Response = await handler.fetch(req, env, ctx);
    if (!res.ok) throw new Error(`background tick failed with HTTP ${res.status}`);
  },
};

export default worker;
