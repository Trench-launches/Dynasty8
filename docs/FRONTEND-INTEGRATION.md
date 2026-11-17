# Frontend integration guide (for Jack)

The API is served by the same Next.js app, so the frontend can call it on the same origin. Nothing in your components was changed; the backend only added files.

- Types: `src/contracts/api.ts` (pure types, import anywhere).
- Client: `src/lib/api-client/client.ts` (`api.listProperties`, `api.getProperty`, `api.getPropertyMarket`, `api.getPropertyChart`, `api.getEcosystem`, `api.getEcosystemMarkets`).
- Adapters to the existing mock types: `src/lib/api-client/adapter.ts` (`toTokenIdentity`, `toMarketView`, `toPricePoints`, `hasMapPosition`, `CATEGORY_LABEL`).
- Full spec: `docs/openapi.yaml`.

## Environment

| Variable | Where | Default |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | browser | empty = same origin |

No other variable is needed by the frontend. Never expose `SOLANA_RPC_URL` or provider keys to the browser.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/properties` | `page` (1), `pageSize` (≤50, default 24), `q` (name contains or exact ticker, `$` optional), `category`, `region`, `verification`, `featured=true|false`, `sort=featured|name|marketCap|volume|change24h`, `order=asc|desc`. Unknown params are rejected with 400. |
| GET | `/api/properties/{slug}` | Detail: description, gallery, sources. |
| GET | `/api/properties/{slug}/market` | `{ slug, token, market }`. Cheap; poll every 30–60 s if needed. |
| GET | `/api/properties/{slug}/chart?range=1h|24h|7d|30d|all` | Candles or an explicit unavailable state. |
| GET | `/api/ecosystem` | REALTY token + totals + disclaimer. |
| GET | `/api/ecosystem/markets` | Live property tokens with markets. |
| GET | `/api/health` | Ops only. |

Public endpoints need no authentication. They are rate limited (120 req/min per IP), so avoid polling every property separately; use the list endpoint.

## Example: list item (current state of every listing)

```json
{
  "id": "cmw...",
  "slug": "starlet-motel",
  "name": "Starlet Motel",
  "category": "SAFEHOUSE",
  "typeLabel": "Motel",
  "region": null,
  "neighbourhood": null,
  "map": null,
  "imageUrl": null,
  "locationVerification": "CONCEPT",
  "featured": false,
  "proposedTicker": "STARLET",
  "token": {
    "id": "cmw...", "mintAddress": null, "name": "Starlet Motel", "ticker": "STARLET",
    "imageUrl": null, "pumpFunUrl": null, "deploymentStatus": "NOT_LAUNCHED",
    "launchedAt": null, "creatorWallet": null, "isNative": false,
    "metadataStatus": "UNVERIFIED", "venue": "UNKNOWN", "decimals": null, "supplyRaw": null
  },
  "market": {
    "freshness": "UNAVAILABLE", "reason": "NOT_LAUNCHED", "source": null,
    "priceUsd": null, "priceSol": null, "marketCapUsd": null, "fdvUsd": null,
    "volume24hUsd": null, "change24hPct": null, "liquidityUsd": null,
    "lastTradeAt": null, "updatedAt": null
  }
}
```

A live token with fresh data looks like this (`market` only):

```json
{ "freshness": "FRESH", "reason": null, "source": "dexscreener", "priceUsd": 0.000412, "priceSol": 0.0000031,
  "marketCapUsd": 412000, "fdvUsd": 412000, "volume24hUsd": 88400, "change24hPct": 12.4,
  "liquidityUsd": 25000, "lastTradeAt": null, "updatedAt": "2026-11-17T12:00:00.000Z" }
```

Chart:

```json
{ "range": "24h", "status": "OK", "reason": null, "interval": "15m", "source": "geckoterminal",
  "candles": [{ "t": 1794900000, "open": 0.0004, "high": 0.00042, "low": 0.00039, "close": 0.000412, "volumeUsd": 1200 }],
  "fetchedAt": "2026-11-17T12:00:05.000Z" }
```

## States the UI must handle

| Condition | What the API returns | Suggested UI |
|---|---|---|
| Token not launched (all 15 today) | `market.freshness = "UNAVAILABLE"`, `reason = "NOT_LAUNCHED"`, all numbers `null` | "Not launched" badge, show `$proposedTicker`, hide numbers and charts, keep trade button disabled |
| Launched, no data yet | `UNAVAILABLE`, `NO_DATA_YET` | "Market data pending" |
| Token deactivated | `UNAVAILABLE`, `TOKEN_INACTIVE` | "Trading paused", no link |
| Data older than 3 min | `freshness = "STALE"`, numbers present, `updatedAt` set | Show numbers greyed with "Last updated …"; never label as live |
| Fresh data | `FRESH` | Normal display |
| Some metric missing | that field is `null` (never `0`) | Show "—" |
| Chart unavailable | `status = "UNAVAILABLE"`, `reason` one of NOT_LAUNCHED / NO_POOL / NO_HISTORY / RATE_LIMITED / PROVIDER_UNAVAILABLE, `candles = []` | Empty state; for RATE_LIMITED offer retry later |
| No coordinates | `map = null` | Do not place on the map; list only. All 15 are `null` today. |
| Location evidence | `locationVerification` VERIFIED / REPORTED / CONCEPT | Badge; CONCEPT = "Unconfirmed location" |
| `pumpFunUrl` | Non-null only for a LIVE, verified mint with an on-chain Pump.fun curve | Only render a trade/market link when non-null |

`toMarketView()` encodes these rules: `data` is non-null only for FRESH, complete data (shaped like the existing `TokenMarketData`, minus `holders` and `bondingCurvePct`, which the backend does not provide); `label` gives a ready-made status string; `raw` gives the nullable values.

## Errors

All errors use `{ "error": { "code", "message", "details"? } }` with codes BAD_REQUEST (400), NOT_FOUND (404), RATE_LIMITED (429), INTERNAL (500), plus UNAUTHORIZED / FORBIDDEN / CONFLICT / UNPROCESSABLE on admin routes. `api.*` throws `ApiClientError` with `status` and `code`.

## Changes the current frontend needs to go live

The prototype UI still reads `src/data/properties.ts` (10 GTA V demo listings with demo numbers and hand-placed map coordinates). To switch to the backend:

1. Replace `getProperties()` / `getProperty()` in `src/lib/data.ts` with `api.listProperties()` / `api.getProperty()` (server components can call them directly).
2. Make market fields nullable in the cards, preview, token stats and markets table, and show the states above. Remove the "Demo data" tags once real data is shown, but keep them for anything still mocked.
3. The map needs coordinates. All 15 launch properties have `map: null` until verified positions are entered (admin PATCH with `mapX`/`mapY` in the map's 0–1000 × 0–700 space, plus a source if marked VERIFIED/REPORTED). Until then, show them in the list/grid only.
4. Property art: `imageUrl` is null for all 15; keep the generated SVG art as the fallback (you will need art styles for the new property types).
5. Neighbourhood/category filters: use the backend enums (`CATEGORY_LABEL`) and `region` once regions are entered.
6. REALTY panel: read `api.getEcosystem().nativeToken` (currently NOT_LAUNCHED).
7. Chart: `toPricePoints(chart)` returns the `PricePoint[]` the existing `PriceChart` uses, or `null` for the empty state.

## Admin API (not for the public frontend)

Admin routes under `/api/admin/*` need a GitHub sign-in (`/api/auth/signin`) by an account granted with `npm run admin:grant`, and a same-origin `Origin` header on mutations. See `docs/openapi.yaml`. An admin UI is not part of this phase.
