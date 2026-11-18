import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const log: ("warn" | "error")[] = process.env.NODE_ENV === "test" ? [] : ["warn", "error"];

/** True inside Cloudflare Workers (workerd). Node (next dev/start, scripts, tests) reports "Node.js/…". */
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * On Cloudflare a database connection must not outlive the request that opened it, so each
 * request gets its own client (keyed by the request's ExecutionContext) and every pooled
 * connection is used once. Hyperdrive, when bound, keeps the real connections to Postgres warm;
 * without it the client connects straight to DATABASE_URL.
 */
const perRequest = new WeakMap<object, PrismaClient>();

function requestClient(): PrismaClient {
  const { env, ctx } = getCloudflareContext();
  let client = perRequest.get(ctx);
  if (!client) {
    const connectionString = env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString, maxUses: 1 }), log });
    perRequest.set(ctx, client);
  }
  return client;
}

function workersClient(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      const client = requestClient();
      const value = Reflect.get(client, prop, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Node: a single client per process (survives Next.js dev hot reloads). Cloudflare: one per request. */
export const prisma: PrismaClient = onWorkers ? workersClient() : (globalForPrisma.prisma ?? new PrismaClient({ log }));

if (!onWorkers && process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
