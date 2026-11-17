import "server-only";
import { z } from "zod";

/**
 * All configuration comes from environment variables, validated once.
 * Secrets (RPC URL with key, provider keys, auth secrets) are server-only and never
 * exported to client components: this module imports "server-only".
 */
const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),

  // Solana RPC. The public endpoint is heavily rate-limited; use a keyed provider in production.
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),

  // Optional providers. Each adapter is disabled when its key is missing.
  HELIUS_API_KEY: z.string().min(1).optional(),
  BIRDEYE_API_KEY: z.string().min(1).optional(),
  ENABLE_DEXSCREENER: bool(true),
  ENABLE_GECKOTERMINAL: bool(true),

  // Market data timing.
  MARKET_POLL_INTERVAL_MS: z.coerce.number().int().min(15_000).default(60_000),
  MARKET_STALE_AFTER_MS: z.coerce.number().int().min(30_000).default(180_000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),

  // Admin auth (Auth.js / NextAuth with GitHub OAuth).
  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(32).optional(),
  GITHUB_ID: z.string().min(1).optional(),
  GITHUB_SECRET: z.string().min(1).optional(),

  // Comma-separated extra origins allowed to call admin mutations (besides NEXTAUTH_URL).
  ADMIN_ALLOWED_ORIGINS: z.string().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  // Empty values (e.g. `NEXTAUTH_SECRET=""` copied from .env.example) mean "not set".
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    // Never echo values: they may be secrets.
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook. */
export function resetConfigForTests() {
  cached = null;
}

export function adminAuthConfigured(cfg = getConfig()) {
  return Boolean(cfg.NEXTAUTH_SECRET && cfg.GITHUB_ID && cfg.GITHUB_SECRET);
}
