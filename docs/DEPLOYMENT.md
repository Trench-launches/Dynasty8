# Deployment guide

Production deployment, DNS, and any infrastructure change need the owner's explicit approval.

## Cloudflare (current host)

The app runs on Cloudflare Workers via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare), with PostgreSQL on Supabase (project `dynasty8`). The Worker is `dynasty8`, built from `main` by Workers Builds (push to deploy). Domain: `dynasty15.xyz` (DNS on Cloudflare).

| Piece | Where | Notes |
|---|---|---|
| web + API | Worker `dynasty8` | `wrangler.jsonc`, entry `custom-worker.ts` (wraps the OpenNext build in `.open-next/`) |
| background jobs | same Worker, Cron Trigger `* * * * *` | `scheduled()` calls `POST /api/internal/tick` with `CRON_SECRET`: one market sync + one Demolition Fund pass per minute (snapshot pruning hourly) |
| database | Supabase PostgreSQL | Optional Hyperdrive binding (`HYPERDRIVE`) in front of it; without it the Worker connects to `DATABASE_URL` directly |
| migrations + seed | build step | `prisma migrate deploy`, then the idempotent seed (adds missing launch listings, never overwrites edits), before the OpenNext build |

Workers Builds settings (Worker -> Settings -> Build):

- Build command: `npm run db:migrate && npm run db:seed && npm run build:cf`
- Deploy command: `npm run deploy`
- Build variables: `DATABASE_URL` (Supabase **Session pooler** URL, port 5432; migrations need a session connection)
- Branch builds: Workers Builds runs the same build command for every pushed branch, with the production `DATABASE_URL`. `db:migrate` and `db:seed` go through `scripts/db-task.mjs`, which **skips them unless `WORKERS_CI_BRANCH` is `main`** (override with a `PRODUCTION_BRANCH` build variable). So pull-request branches build without touching the production database. Stricter still: give non-production branches their own build command without the database steps, or a separate preview database.

Worker secrets (Worker -> Settings -> Variables and Secrets), never in files: `DATABASE_URL` (the same Session pooler URL; Supabase's direct host is IPv6-only), `SOLANA_RPC_URL`, `CRON_SECRET` (any long random string; the background jobs stay off until it is set), and for admin `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`, plus any provider keys from `.env.example`.

Plan: the app needs the Workers Paid plan. The free plan allows 10 ms of CPU per request, which server-rendered pages and the database client exceed.

Why some things differ from a Node host:

- Next.js Cache Components (`"use cache"`, partial prerendering) is off: the Cloudflare adapter does not yet run it reliably on Next 16.4 (opennextjs-cloudflare issues #1450, #1464). Pages render per request; re-enable when the adapter supports it.
- A database connection may not outlive its request on Workers, so `src/server/db.ts` creates one Prisma client per request there (Node keeps one per process).
- The fund pass lock is transaction-scoped (`pg_try_advisory_xact_lock`) so it cannot be stranded on a pooled connection.
- Map tile URLs percent-encode their commas; Cloudflare's asset server redirects raw commas.

Local check in Cloudflare's runtime: copy `.dev.vars.example` to `.dev.vars`, start the local database (`npm run db:local`), then `npm run preview`. On Windows, if `preview` fails with `read ECONNRESET`, run `npm run build:cf` and then `npx wrangler dev --port 8790 --ip 127.0.0.1 --inspector-port 9339`. Trigger the scheduled handler with `curl "http://127.0.0.1:8790/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"`.

## Any Node host

The app also runs as a plain Node service (Railway, Render, a VPS): one Next.js app plus worker processes sharing PostgreSQL.

| Process | Command | Notes |
|---|---|---|
| web | `npm run build` then `npm run start` | Stateless; scale horizontally once cache/rate-limit use Redis |
| workers | `npm run sync:markets`, `npm run fund:worker` | One instance each. Or run each with `-- --once` from a scheduler every minute |
| release | `npm run db:migrate` | Run before starting new web/worker versions |

## Environment

See `.env.example`. Required in production: `DATABASE_URL`, `SOLANA_RPC_URL` (keyed), and for admin access `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`. Store them in the platform's secret manager, not in files. Create the GitHub OAuth app with callback `https://<domain>/api/auth/callback/github`.

First admin (operator with DB access):

```bash
npm run admin:grant -- --github-id <numeric id> --login <login> --role ADMIN
```

## GitHub OAuth (admin sign-in)

Admin pages and APIs (`/admin/treasury`, `/api/admin/*`) use Auth.js with GitHub. Only GitHub accounts listed in `AdminUser` can sign in; there are no default admins.

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App** (create it under the account or org that should own it):
   - Application name: `Dynasty 8 admin`
   - Homepage URL: `https://dynasty15.xyz`
   - Authorization callback URL: `https://dynasty15.xyz/api/auth/callback/github`
2. Copy the Client ID and generate a client secret.
3. Cloudflare → Worker `dynasty8` → Settings → Variables and Secrets, as **secrets**:
   - `GITHUB_ID` = client ID;
   - `GITHUB_SECRET` = client secret;
   - `NEXTAUTH_SECRET` = output of `openssl rand -base64 32`;
   - `NEXTAUTH_URL` = `https://dynasty15.xyz`.
4. Grant the first admin, from a machine whose `DATABASE_URL` points at production:
   `npm run admin:grant -- --github-id <numeric id> --login <login> --role ADMIN`. Find the numeric id with `gh api users/<login> --jq .id`.
5. Visit `https://dynasty15.xyz/admin/treasury` → "Sign in with GitHub". Sessions last 8 hours, and roles are re-read on every request, so `--revoke` takes effect immediately.

For local development, create a second OAuth app with callback `http://localhost:3530/api/auth/callback/github` and put its values in `.env`.

## Treasury registration (production)

The confirmed treasury is in `config/treasury.mainnet.json`: Squads multisig `BF8X…2Ljn`, with vaults 0/1/2 = fund/ecosystem/operations at 6000/2500/1500. With `DATABASE_URL` pointing at production and `SOLANA_RPC_URL` set:

```bash
npm run fund:register -- --config config/treasury.mainnet.json --check   # verify on-chain, write nothing
npm run fund:register -- --config config/treasury.mainnet.json           # register all three
```

The command re-derives each vault from the multisig, reads the multisig on-chain (threshold ≥ 2, members who can propose / vote / execute), checks the split against the fund config, and records an audit entry. It accepts addresses only. The same can be done one wallet at a time through `PUT /api/admin/demolition-fund/wallets` (ADMIN).

## Release steps

1. CI green (`.github/workflows/ci.yml`: prisma validate, typecheck, lint, tests on a fresh embedded PostgreSQL, build).
2. Take a database backup (below).
3. `npm run db:migrate` (`prisma migrate deploy`; applies only new migrations).
4. `npm run db:seed` on first deploy only (idempotent; never overwrites edits).
5. Deploy (on Cloudflare: merge to `main`; Workers Builds migrates, builds and deploys).
6. Check `GET /api/health` is `ok`.

## Backups

- Enable the host's automated daily PostgreSQL backups with point-in-time recovery if available.
- Before every migration: `pg_dump --format=custom --no-owner "$DATABASE_URL" > d8-$(date +%F-%H%M).dump`.
- Test a restore into a scratch database monthly: `pg_restore --clean --no-owner -d "$SCRATCH_URL" d8-....dump`.
- `AuditLog` must be included; it is the record of admin and token changes.

## Migration rollback plan

Prisma does not generate down-migrations. For each migration:

1. Prefer forward fixes: write a new migration that reverses the change.
2. If a migration fails midway: `npx prisma migrate resolve --rolled-back <migration_name>` after restoring the pre-migration dump.
3. Keep migrations additive (add columns nullable, backfill, then tighten) so the previous app version keeps working during a rollout.
4. Roll the app back to the previous image only after the schema is compatible with it.

## Monitoring

- Uptime check on `/api/health` (alert on non-200 or `status: "degraded"`).
- `marketData.stale: true` means the worker is down or providers are failing: alert after 10 minutes.
- Logs are JSON (pino). Alert on `level >= 50` (error) bursts and on repeated `"provider request failed"` / `"market provider failed"` warnings.
- Track 429 rates (`RATE_LIMITED`) on public endpoints.
- Review `/api/admin/audit` after every admin session.
