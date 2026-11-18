// Cloudflare entry point: the Next.js app (built by `opennextjs-cloudflare build` into .open-next/)
// plus a scheduled handler that runs the background jobs once a minute (see wrangler.jsonc "triggers").
// Bundled by Wrangler, not by Next.js, so it is excluded from the app's tsconfig.
// @ts-expect-error generated at build time
import { default as handler } from "./.open-next/worker.js";

interface Env {
  CRON_SECRET?: string;
}

const worker = {
  fetch: handler.fetch,

  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
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
