# Deployment guide

Nothing has been deployed. Production deployment, DNS, and any infrastructure change need the owner's explicit approval.

## Shape

One Next.js app (frontend + API) and one worker process, sharing a PostgreSQL database.

| Process | Command | Notes |
|---|---|---|
| web | `npm run build` then `npm run start` | Stateless; scale horizontally once cache/rate-limit use Redis |
| worker | `npm run sync:markets` | Exactly one instance. Or `npm run sync:markets -- --once` from a scheduler every minute |
| release | `npm run db:migrate` | Run before starting new web/worker versions |

Railway: no Railway configuration exists in this repository, so there is no existing project to share. On Railway, the same shape is three pieces in one project: a PostgreSQL plugin, a web service, and a worker service (start command `npm run sync:markets`), with `npm run db:migrate` as the pre-deploy command. Any platform with Node 22 + PostgreSQL works.

## Environment

See `.env.example`. Required in production: `DATABASE_URL`, `SOLANA_RPC_URL` (keyed), and for admin access `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID`, `GITHUB_SECRET`. Store them in the platform's secret manager, not in files. Create the GitHub OAuth app with callback `https://<domain>/api/auth/callback/github`.

First admin (operator with DB access):

```bash
npm run admin:grant -- --github-id <numeric id> --login <login> --role ADMIN
```

## Release steps

1. CI green (`.github/workflows/ci.yml`: prisma validate, typecheck, lint, tests on a fresh embedded PostgreSQL, build).
2. Take a database backup (below).
3. `npm run db:migrate` (`prisma migrate deploy`; applies only new migrations).
4. `npm run db:seed` on first deploy only (idempotent; never overwrites edits).
5. Deploy web, then worker.
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
