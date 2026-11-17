# Backend architecture

The backend lives inside the existing Next.js app (App Router route handlers under `src/app/api`), so there is one deployable and no second application. Server code is in `src/server/` and imports `server-only`, so it can never be bundled into the browser.

```
src/contracts/api.ts          Public API types (shared with the frontend)
src/server/
  config.ts                   Env validation (zod). Secrets never leave the server.
  db.ts                       Prisma client
  logger.ts                   pino structured JSON logs with redaction
  cache.ts                    In-process TTL cache + in-flight de-duplication
  sanitize.ts                 Untrusted-string / URL / number sanitisation
  http/fetch-json.ts          Outbound HTTP: host allowlist, timeout, retry/backoff, size cap
  http/rate-limit.ts          Inbound limits (per IP) and outbound provider budgets
  http/responses.ts           JSON/error helpers, strict query parsing, body parsing
  solana/address.ts           Public-key validation, well-known program ids
  solana/rpc.ts               Read-only RPC: mint account, Pump.fun bonding-curve detection
  providers/                  Adapters behind interfaces (types.ts)
    dexscreener.ts            Market quotes (batch of 30, no key)
    geckoterminal.ts          OHLCV charts (no key, ~10 calls/min)
    birdeye.ts                OHLCV fallback (key)
    helius.ts                 Token metadata via DAS getAsset (key)
    registry.ts               Builds the enabled set from config
  services/
    properties.ts             Property registry reads, filtering, sorting
    market-sync.ts            Background sync: provider -> MarketSnapshot rows
    charts.ts                 Chart history with caching and explicit unavailable states
    ecosystem.ts              DYNASTY native token + aggregates
    admin-properties.ts       Admin property CRUD
    admin-tokens.ts           Mint registration + verification (read-only chain checks)
    audit.ts                  Append-only audit log
    mappers.ts                DB rows -> API DTOs (freshness rules live here)
  auth/                       Auth.js (GitHub OAuth) + server-side RBAC guard
  catalogue.ts                Launch catalogue (15) + reserve candidates (18, not seeded)
prisma/schema.prisma          Data model; migrations in prisma/migrations
scripts/                      local-postgres, sync-worker, admin-grant, db-reset-local
```

## Data model

| Table | Purpose |
|---|---|
| `Property` | Listing. `mapX/mapY` null until verified (DB check: set together). `locationVerification` = VERIFIED / REPORTED / CONCEPT, describing source evidence for the GTA location, not the token. `status` DRAFT / PUBLISHED / UNPUBLISHED / DISABLED. `proposedTicker` is a catalogue proposal. |
| `SourceReference` | Evidence for a location. VERIFIED or REPORTED requires at least one (enforced by the API). |
| `Token` | One per property, plus the single native token. `mintAddress` is the unique identity of a deployed token (unique index); tickers are never used as identity. DB checks: only one native token; a native token has no property; NOT_LAUNCHED has no mint; PENDING/LIVE must have one. |
| `MarketSnapshot` | One provider observation. Every metric nullable: null = not supplied, never zero. |
| `AdminUser` | GitHub id + role (VIEWER / EDITOR / ADMIN) + active flag. No default rows. |
| `AuditLog` | Who changed what (before/after JSON), including system venue changes. |

Migration: `prisma/migrations/20261117124001_init` (tables + the check/partial-unique constraints above).

## Market data flow

1. `npm run sync:markets` (separate worker process, or `--once` from cron) selects LIVE tokens with a mint, calls the first working market provider (DexScreener) in batches of 30, and writes one snapshot per token the provider actually returned. Missing tokens get no row.
2. Public API requests **only read the database**. They never call providers, so traffic spikes cannot exhaust provider quotas or be used to make the server send requests.
3. `mappers.toMarketDto` sets `freshness`: no snapshot = UNAVAILABLE (`NO_DATA_YET`); older than `MARKET_STALE_AFTER_MS` = STALE; otherwise FRESH. Non-live tokens are always UNAVAILABLE with a reason.
4. Venue changes (e.g. `pumpfun` to `pumpswap` after migration) are detected from the provider's `dexId` and audited.

Charts are fetched on demand (GeckoTerminal, then Birdeye if keyed) using the pool address from the latest DexScreener snapshot, cached per token+range (1 min to 1 h), with failures cached for 60 s and a hard outbound budget of 8 GeckoTerminal calls per minute. If nothing is available the response is `status: "UNAVAILABLE"` with a reason. Candles are never synthesised.

## Provider investigation (2026-11-17)

| Provider | Used for | Key | Documented limits / notes |
|---|---|---|---|
| DexScreener `tokens/v1/solana/{addrs}` | Price USD, price in SOL (when quote is wSOL), market cap, FDV, 24h volume, 24h change, liquidity, pair address, dex id | No | Up to 30 addresses per call, 300 req/min. No REST price history. No last-trade time. Field names confirmed from a live response. |
| GeckoTerminal v2 `pools/{pool}/ohlcv/{day,hour,minute}` | Charts | No | Confirmed from `api.geckoterminal.com/docs/v2/swagger.json`: aggregate day 1 / hour 1,4,12 / minute 1,5,15; limit ≤ 1000; ~10 calls/min, cached 1 min upstream. API marked beta. |
| Birdeye `/defi/ohlcv` | Chart fallback | Yes (`X-API-KEY`, `x-chain`) | Endpoint marked deprecated in favour of a v3 OHLCV endpoint whose parameters were not confirmed; migrate when they are. Free tier is very limited. |
| Helius DAS `getAsset` | Token name/symbol/image, supply/decimals at registration | Yes (`api-key` query) | Price info only for top tokens; not used for prices. |
| Pump.fun | Bonding-curve detection | No (on-chain) | No official public HTTP API. Official docs (`pump-fun/pump-public-docs`) define program `6EF8rr...F6P`, bonding-curve PDA seeds `["bonding-curve", mint]`, and the `complete` flag. We read that account via RPC. The `https://pump.fun/coin/<mint>` link format is the site's public URL convention, not an API; it is only produced for a mint whose bonding-curve account exists on-chain, and only exposed once an admin marks the token LIVE. |
| Solana RPC | Mint existence, supply, decimals, authorities; curve account | Public or keyed URL | Read-only methods only (`getAccountInfo`, `getParsedAccountInfo`). |

Holder counts and bonding-curve progress percentage are not provided by any adapter here, so the API does not return them.

## Scaling notes

- The listing sorts market metrics in memory over the filtered set. That is fine for tens to low hundreds of listings. Beyond that, add materialised `latestMarketCap/latestVolume/latestChange` columns on `Token`, updated by the sync job, and sort in SQL.
- `cache.ts` and `rate-limit.ts` are per-process. For more than one web instance, back the same interfaces with Redis so budgets and caches are shared.

## Not implemented (by design) and what each would need

- **Token deployment, trading, signing:** none. The admin API can only register a mint that already exists.
- **Buybacks / fee distribution to DYNASTY:** not implemented, and the API states that property-token fees do not accrue to DYNASTY. Doing this later would need: a defined on-chain fee source (e.g. Pump.fun creator fees, which only reach the creator wallet), a custody design (multisig, not a hot key), a signing service separate from this API with its own approvals and audit, legal review, and public disclosure of the mechanism.
- **Creator-fee analytics:** would need a creator-wallet verification flow (signed message) and an indexer for fee transfers.
