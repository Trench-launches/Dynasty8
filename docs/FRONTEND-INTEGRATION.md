# Frontend integration

The backend and the 3D-map frontend run in one Next.js app. The UI is wired to the backend;
this note explains how, and what to touch when either side changes.

## Two shapes, one adapter

- **Wire format (DTOs):** `src/contracts/api.ts`. What the `/api/*` routes return; see `docs/openapi.yaml`.
- **View models:** `src/lib/types.ts`. What the components render (`Property`, `MarketSnapshot`, ...).
- **Adapter:** `src/lib/api-client/adapter.ts` converts DTOs into view models. It is the only place
  the two shapes meet. When a DTO changes, update the adapter; components stay untouched.

| Backend | UI |
|---|---|
| `deploymentStatus` NOT_LAUNCHED / PENDING_VERIFICATION | `token.status = "coming_soon"` |
| `deploymentStatus` LIVE | `"live"`, with mint and Pump.fun link (`mintVerified = true`) |
| `deploymentStatus` INACTIVE | `"unavailable"`, no mint or link |
| `locationVerification` VERIFIED / REPORTED / CONCEPT | `verification.status` confirmed / reported / unverified |
| `map {x, y}` | `location`, `precision: "exact"` only when VERIFIED, else `"approximate"` |
| `typeLabel` (falls back to `category`) | display `category` (motel, garage, nightlife, ...) |
| `region` (id like `vice-city`, or its name) | `RegionId`, or `null` |
| `market.freshness` UNAVAILABLE | `market = null` |
| `market.freshness` STALE | numbers kept, `stale: true` (shown as **Delayed**) |
| `launchOrder` | `priority` (launch-batch sort order) |
| `imageUrl` (null) | bundled photo from `public/properties/<slug>.jpg`, else generated art |

## Where data is read

- **Server components** (`/`, `/markets`, `/property/[slug]`) use `src/lib/catalogue.ts`. It calls the
  backend services directly (no HTTP round trip to its own API), behind `connection()` so builds never
  touch the database, and caches results for a few seconds (`cacheLife("seconds")`).
  `src/app/loading.tsx` is the Suspense boundary while that data loads.
- **Client components** refresh through `src/lib/api.ts` → `src/lib/api-client/client.ts` → `/api/*`.
  The marketplace re-polls the listing; the property page polls its market every 30 s.
- **Mock mode:** `NEXT_PUBLIC_MOCK_API="true"` swaps both paths for `src/lib/mock-api.ts`. No database.

## Environment

| Variable | Where | Default |
|---|---|---|
| `NEXT_PUBLIC_MOCK_API` | both | `"false"` = real backend |
| `NEXT_PUBLIC_DEMO_MARKETS` | mock mode only | `"false"` |
| `NEXT_PUBLIC_API_BASE_URL` | browser | empty = same origin |

Never expose `SOLANA_RPC_URL` or provider keys to the browser.

## The catalogue

`src/data/catalogue.ts` is the single list of launch listings: names, tickers, type labels,
regions, neighbourhoods, approximate map positions, featured flags and descriptions. The database
seed (`prisma/seed.ts`) and mock mode both read it, and a test checks the two produce identical
listings. The seed is idempotent and never overwrites admin edits, so after the first seed change
placements through the admin API (`PATCH /api/admin/properties/{slug}` with `mapX`/`mapY`).

## States the UI handles

| Condition | API | UI |
|---|---|---|
| Token not launched (all 15 today) | `UNAVAILABLE`, `NOT_LAUNCHED` | No status badge, ticker shown, no numbers or chart |
| Launched, no data yet | `UNAVAILABLE`, `NO_DATA_YET` | "Live" badge, no numbers yet |
| Token deactivated | `UNAVAILABLE`, `TOKEN_INACTIVE` | "Unavailable", no link |
| Data older than 3 min | `STALE` | numbers with a **Delayed** tag and last-updated time |
| A metric missing | that field `null` | "—" |
| Chart unavailable | `status = "UNAVAILABLE"` | empty-chart message |
| No coordinates | `map = null` | sidebar only, "Map placement pending" |

## Not provided by the backend

Holder counts and bonding-curve progress: no adapter supplies them, so `holders` is always `null`.

## Admin API (not for the public frontend)

Admin routes under `/api/admin/*` need a GitHub sign-in (`/api/auth/signin`) by an account granted
with `npm run admin:grant`, and a same-origin `Origin` header on mutations. There is no admin UI yet.

## Demolition Fund

Types: `src/contracts/demolition-fund.ts`. Details: `docs/DEMOLITION-FUND.md`.

| Endpoint | Use |
|---|---|
| `GET /api/demolition-fund/summary` | Fund header: total fees, % split, pending buyback, DYNASTY purchased / burned, latest buyback and burn, paused / breaker state. Also `treasury` (allocation mode, balances observed at the last reconciliation — `null` until then —, reserve, liabilities, owed vs paid-direct shares, wallets with multisig `threshold` / `members`), `pendingActions` (multisig proposals waiting for signers), `buybacks` (last 20 with a `verification` status) and `feeSharing` (config check counts and issues) |
| `GET /api/demolition-fund/properties` | Leaderboard and map overlay: rank, creator fees, buyback share, DYNASTY burned per property, `mapPosition` (null until verified) |
| `GET /api/demolition-fund/history?limit&before` | Activity feed; pass `nextBefore` to page |
| `GET /api/demolition-fund/burns` | Burn list with linked buyback |
| `GET /api/demolition-fund/transactions/{signature}` | Detail page / deep link |

Display rules:
- Amounts are **strings in base units**. SOL: divide lamports by 1e9. DYNASTY: divide by `10 ** summary.dynasty.decimals`. Use `BigInt` or a decimal library, not `Number`, for totals.
- Every figure is verified on-chain; `"0"` means a verified zero. Before any activity everything is `"0"` and `rank` is `null`: show "No contributions yet", never placeholder numbers.
- Show `status.paused` / `status.circuitOpen` as a notice ("Buybacks paused").
- Link every signature with the provided `explorerUrl`.
- Contribution `rank` is null for properties with no verified revenue; sort those last.
- `treasury.fundBalanceLamports` is `null` until the first reconciliation: show "Not observed yet", not 0.
- The `/fund` page already uses all of these (`src/components/fund/*`). Still missing: a wallet UI for multisig members to sign and send the unsigned proposal transaction returned by `POST /api/admin/demolition-fund/buybacks/{id}/propose-swap|propose-burn`.
