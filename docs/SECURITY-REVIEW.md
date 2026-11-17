# Security review: backend foundation (2026-11-17)

Scope: everything under `src/server`, `src/app/api`, `prisma`, `scripts`. Reviewed by the implementing engineer; this is not a substitute for an independent review before launch.

| Area | Status | How it is handled | Test coverage |
|---|---|---|---|
| API authentication | OK | Public read API is anonymous by design. Admin routes need an Auth.js (NextAuth v4) GitHub OAuth session; JWT verified server-side with `NEXTAUTH_SECRET`. Sign-in itself is refused for GitHub accounts not in `AdminUser`. Sign-in is disabled (404) until configured. | admin-api: 401 anonymous |
| Admin permissions | OK | `requireAdmin(role)` on every admin handler, role re-read from DB each request (revocation immediate). VIEWER < EDITOR < ADMIN; verification changes, DISABLED, mint registration and token status need ADMIN. No default admins; first admin via CLI with DB access. | admin-api: 403 non-admin, inactive admin, role matrix |
| CSRF | OK | Mutations require an `Origin` header matching the app origin / `NEXTAUTH_URL` / `ADMIN_ALLOWED_ORIGINS`; Auth.js cookies are SameSite=Lax; JSON content type required. | admin-api: evil origin, missing origin |
| Database access / SQL injection | OK | Prisma parameterised queries only. The two raw statements (`SELECT 1`, test-only TRUNCATE) take no input. DB-level constraints back up API rules (unique mint, single native token, status/mint consistency, map x/y pairing). | database: constraint tests; public-api: hostile query strings |
| Input validation | OK | zod schemas for every query/body; unknown or duplicate query params rejected; bodies `.strict()`, 64 KB cap; slug, ticker, URL (https only, no credentials), control/bidi characters rejected. | public-api + admin-api validation tests |
| XSS | OK | API returns JSON only with `nosniff`. Provider strings are stripped of markup/control/bidi characters and length-limited; the React frontend renders them as text. Admin image URLs must be https. Metadata image URLs are stored but never fetched by the server. | unit sanitize, Helius parsing |
| SSRF | OK | Outbound HTTP goes through `fetchJson`, which only allows https to four fixed provider hosts and disables redirects. No endpoint accepts a URL to fetch. RPC URL comes from env only. Path segments (mints, pools) are validated public keys. | unit: blocked hosts |
| Malicious metadata / token impersonation | OK | Mint address is the identity; tickers are never trusted. Market quotes only accepted where the pair's base token equals our exact mint on chain `solana`. Registration checks the account exists and is an SPL mint; a symbol mismatch is flagged and needs an explicit, noted acknowledgement to verify. Pump links only for an on-chain curve, only shown when LIVE. | providers: impostor pairs; admin: mismatch flow, invalid/nonexistent mints |
| Provider response manipulation | OK | zod-parsed; non-finite, negative and absurd values (> 1e13 USD) become `null`; OHLCV rows with inconsistent high/low dropped; size caps on responses. | providers tests |
| Cache poisoning | OK | Cache keys built only from validated ids and enum ranges. HTTP `s-maxage` only on public, non-personalised responses; admin responses `no-store`. | n/a |
| API abuse / rate-limit exhaustion | OK (single instance) | 120/min/IP public, 30/min/IP admin. Public requests never call providers; charts have per-provider outbound budgets and negative caching. Limits are in-memory: move to Redis when running several instances. `x-forwarded-for` is trusted, so deploy behind a proxy that sets it. | public-api: 429; providers: budget |
| Secret exposure | OK | Secrets only in env; config module is `server-only`; logs redact URLs/keys/cookies; error responses are generic (no stack/SQL); `.env` gitignored; health endpoint reveals no hosts or versions. | manual review |
| Transactions / keys | OK | No keypairs, signing or transaction code exists. RPC usage is `getAccountInfo` / `getParsedAccountInfo` only. | grep-able: no `sendTransaction`, `Keypair` only in tests |
| Dependency vulnerabilities | Partly accepted | See below. | `npm audit --omit=dev` |

## Dependency audit (npm audit --omit=dev)

- **zod** high (memory exhaustion on oversized collections): fixed by upgrading to zod 4.6.7.
- **next → postcss** (high/moderate): build-time CSS tooling; no attacker-controlled CSS at runtime. Fix requires Next 16 (major). Accepted for now; upgrade with the frontend.
- **prisma → @prisma/config → deepmerge-ts** (high): CLI/config tooling, not the runtime query path. Fix requires Prisma 7 (major). Accepted for now.
- **@solana/web3.js 1.x → jayson → uuid / stream-json** (moderate): RPC client internals; responses come only from the operator-configured RPC. Fix requires a major migration. Accepted; re-evaluate when moving to the newer Solana SDK.

## Open items before public launch

1. Independent security review of the admin API and auth configuration.
2. Configure a keyed RPC (public mainnet RPC is rate-limited) and keep it server-side.
3. Redis-backed rate limits and cache if more than one instance runs.
4. Decide on a Content-Security-Policy for the frontend (not part of this backend change).
5. Trademark review of names (Dynasty 8, GTA locations) before public use.
