// Cloudflare bindings and secrets this app reads, on top of the ones @opennextjs/cloudflare declares.
// Configured in wrangler.jsonc (bindings) and the Worker's settings (secrets).
interface CloudflareEnv {
  /** Optional Hyperdrive connection pool in front of Postgres. */
  HYPERDRIVE?: { connectionString: string };
  /** Shared secret the scheduled handler sends to /api/internal/tick. */
  CRON_SECRET?: string;
}
