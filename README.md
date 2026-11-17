# Dynasty 8 — Leonida Property Market (frontend)

A map-first property-token marketplace on Solana. Users land straight on an interactive
3D map of Leonida, click house pins to discover properties, and view each property's
Pump.fun token market.

> **Status:** frontend prototype running on mock data. No wallet connection, no trading,
> and no real market figures yet — every token shows **Coming Soon** until the backend
> provides verified data.

## Stack

- **Next.js 16** (App Router, Cache Components) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** (Radix) + **Lucide** icons
- **three.js** via **@react-three/fiber** / **drei** for the 3D map
- **Motion** for panel/sheet animation, **Recharts** for price charts

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint
```

Copy `.env.example` to `.env.local` to configure:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Backend base URL. Unset = in-memory mock API. |
| `NEXT_PUBLIC_DEMO_MARKETS` | `true` fills some tokens with **clearly labelled** demo market numbers so populated states can be designed. Never enable in production. |

## Project structure

```text
src/
  app/
    page.tsx                  # Marketplace: sidebar + 3D map (the whole homepage)
    property/[slug]/page.tsx  # Dedicated property page (prerendered per listing)
    markets/page.tsx          # All property tokens + REALTY ecosystem token
  components/
    map/
      leonida-map.tsx         # Map shell: Canvas, pins layer, controls, legend
      leonida-scene.tsx       # 3D scene: ground, buildings, beacon, camera rig
      map-texture.ts          # Paints the atlas-style map into a canvas texture
      geometry.ts             # Coastlines, regions, roads, districts (map units)
      map-pin.tsx             # House-shaped pin + hover card
    marketplace/              # Sidebar, filters, listing cards, preview panel/sheet
    property/                 # Generated property art, badges, market panel + chart
    layout/                   # Header, REALTY ecosystem chip
  data/
    properties.ts             # MOCK catalogue (15 confirmed launch properties)
    regions.ts                # Regions, map size, labels
  lib/
    types.ts                  # Data contracts shared with the backend
    api.ts                    # Central API client (mock or real backend)
    mock-api.ts               # Mock implementation of the API contract
    catalogue.ts              # Cached server-side reads
    filters.ts                # Search / filter / sort logic
```

## Backend contract

All UI data goes through `src/lib/api.ts`. Shapes live in `src/lib/types.ts`.

| Endpoint | Returns |
| --- | --- |
| `GET /api/properties` | `Property[]` |
| `GET /api/properties/:slug` | `Property` (404 → not found) |
| `GET /api/properties/:slug/market` | `MarketSnapshot \| null` |
| `GET /api/properties/:slug/chart?range=24h\|7d\|30d` | `ChartPoint[]` |
| `GET /api/ecosystem` | `EcosystemToken` |
| `GET /api/ecosystem/markets` | `EcosystemMarkets` |

Rules the UI relies on:

- `market.source` must be `"live"` for real data. Anything `"demo"` is labelled DEMO everywhere.
- The mint address and Pump.fun link only display when `token.mintVerified` is `true`.
- `location` is in map units (x east 0–1200, y south 0–1600). `null` keeps a listing in the
  sidebar only ("Map placement pending"). `precision: "approximate"` = district-level placement.

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

- Property names for `$RIDEOUT`, `$DELIGHTS` and `$BOATWORKS` are provisional (only ticker and
  type were supplied). All map placements are approximate and need team sign-off.
- All artwork, the logo and the map are original. Do not add Rockstar logos, fonts, map art or
  screenshots: this is a commercial token project and Take-Two enforces its IP.
- Property tokens are themed collectibles; the UI must never imply real or in-game ownership.
