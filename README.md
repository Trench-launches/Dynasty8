# Dynasty 8 — Leonida Property Market

A map-first property-token directory on Solana. Users land straight on an interactive
3D map of Leonida, click house pins to discover properties, and view each property's
Pump.fun token market.

One Next.js app holds both halves: the 3D-map frontend and the backend (API routes,
PostgreSQL registry, read-only Solana and market-data adapters, admin API).

> **Status:** all 15 launch listings are proposals; no token is launched yet, so every token
> shows **Coming Soon** and no market figures appear. Nothing here creates, signs or trades
> tokens: admins register mints that already exist on-chain, and trading happens on Pump.fun.

## Stack

- **Next.js 16** (App Router, Cache Components) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Radix) + **Lucide** icons
- **three.js** via **@react-three/fiber** / **drei** for the 3D map
- **Motion** for panel/sheet animation, **Recharts** for price charts
- **PostgreSQL** via **Prisma 6**, **zod** validation, **pino** logs, **Auth.js** (GitHub) for admins
- **Vitest** with an embedded PostgreSQL for tests

## Getting started

```bash
cp .env.example .env        # local defaults work as-is
npm install
npm run db:local            # terminal 1: embedded PostgreSQL on :54329 (no Docker needed)
npm run db:migrate && npm run db:seed
npm run dev                 # terminal 2: app + API on http://localhost:3530
npm run sync:markets        # terminal 3 (optional): market-data worker, only matters once tokens are LIVE
```

UI work without a database: set `NEXT_PUBLIC_MOCK_API="true"` in `.env` and skip the
database steps. `NEXT_PUBLIC_DEMO_MARKETS="true"` then fills some tokens with clearly
labelled demo numbers.

```bash
npm test                    # unit + integration tests on a throwaway PostgreSQL
npm run typecheck
npm run lint
npm run build               # does not need a database: pages read it per request
```

## Project structure

```text
src/
  app/
    page.tsx                  # Marketplace: sidebar + 3D map (the whole homepage)
    property/[slug]/page.tsx  # Property page
    markets/page.tsx          # All property tokens + DYNASTY ecosystem token
    loading.tsx               # Shown while a page's listings load
    api/                      # Backend route handlers (public + admin), see docs/openapi.yaml
  components/
    map/                      # 3D map: scene, texture, geometry, pins
    marketplace/              # Sidebar, filters, listing cards, preview panel/sheet
    property/                 # Property art/photos, badges, market panel + chart
    layout/                   # Header, DYNASTY ecosystem chip
  contracts/api.ts            # Backend wire format (DTOs), shared by server and client
  data/
    catalogue.ts              # THE launch catalogue: seeds the database and the mock
    properties.ts             # Mock-mode listings, built from catalogue.ts
    property-images.ts        # Bundled photos in public/properties/
    regions.ts                # Regions, map size, labels
  lib/
    types.ts                  # View models the components render
    api-client/client.ts      # Typed HTTP client for the backend API
    api-client/adapter.ts     # DTO -> view model (the only place the two shapes meet)
    api.ts                    # Browser data client (backend, or mock)
    catalogue.ts              # Server-side page data (reads the database directly)
    mock-api.ts               # Mock implementation for NEXT_PUBLIC_MOCK_API=true
  server/                     # Backend: config, db, providers, services, auth (server-only)
prisma/                       # Schema, migrations, seed
scripts/                      # local-postgres, sync-worker, admin-grant, db-reset-local
tests/                        # unit + integration tests
docs/                         # Backend architecture, API spec, security review, deployment
```

## How data flows

- **Pages** (server components) call `src/lib/catalogue.ts`, which queries the database through
  the backend services and converts the results with `src/lib/api-client/adapter.ts`. Reads happen
  per request and are cached for a few seconds, so builds never need a database.
- **The browser** refreshes listings and market numbers through `src/lib/api.ts`, which calls the
  `/api/*` routes and converts responses with the same adapter.
- **Market numbers** come only from the database. A separate worker (`npm run sync:markets`) pulls
  DexScreener quotes for LIVE tokens; public requests never call outside providers.

Rules the UI relies on (enforced in the adapter):

- Missing numbers are `null` and show as "—", never zero.
- Market data older than `MARKET_STALE_AFTER_MS` is flagged **Delayed** and never shown as live.
  Anything `source: "demo"` is labelled DEMO.
- The mint address and Pump.fun link only appear for tokens an admin has verified (LIVE).
- `location` is in map units (x east 0–1200, y south 0–1600). Launch listings have approximate
  district placements; `precision: "exact"` is reserved for VERIFIED locations.

## Backend

- Architecture, providers and data model: [docs/BACKEND.md](docs/BACKEND.md)
- API spec: [docs/openapi.yaml](docs/openapi.yaml)
- Frontend integration notes: [docs/FRONTEND-INTEGRATION.md](docs/FRONTEND-INTEGRATION.md)
- Security review: [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md)
- Deployment, backups, rollback, monitoring: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## The map

- Original illustrated island in an in-game atlas style, rendered to a canvas texture and laid
  on a 3D plane, with extruded city blocks.
- **2D / 3D** toggle; drag to pan, scroll or pinch to zoom, right-drag or two-finger rotate
  in 3D; region quick-jump buttons; compass (click to face north); reset view.
- Keyboard: arrows pan, `+`/`-` zoom, `[`/`]` rotate, `0` reset, `Esc` closes the preview.
- Pins are DOM elements projected each frame, so they stay crisp, focusable and accessible.
- Selecting a pin or a listing syncs both ways and flies the camera to it. Deep links:
  `/?p=<slug>`.

## Notes

- All map placements are approximate and need team sign-off. Change them in
  `src/data/catalogue.ts` (new databases) or through the admin API (existing ones).
- All artwork, photos, the logo and the map are original. Do not add Rockstar logos, fonts, map
  art or screenshots: this is a commercial token project and Take-Two enforces its IP.
- The brand name and location names are Rockstar trademarks used as placeholders. Rename before
  any public launch.
- Property tokens are themed collectibles; the UI must never imply real or in-game ownership.
