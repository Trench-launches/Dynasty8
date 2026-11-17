# DYNASTY 8 (placeholder name): frontend prototype

A GTA-inspired property-token marketplace for Solana, styled like an in-game real estate website and painted in a Vice City sunset palette. **Frontend only.** Every market figure is demo data.

## Run it

```bash
npm install
npm run dev        # http://localhost:3530
npm run build      # production build (all pages static)
npm run start      # serve the build on :3530
npm run lint
npm run typecheck
```

## Structure

```
src/
  config/brand.ts                 rename the brand here (name, wordmark, tagline, map label, city)
  data/types.ts                   Property, neighbourhood, category, art types
  data/properties.ts              THE mock data file: 10 properties + REALTY token (all demo)
  lib/data.ts                     async data access + filtering/sorting (swap for an indexer later)
  lib/integrations/types.ts       typed seams: MarketDataProvider, WalletProvider, TradingProvider, TokenIdentity
  lib/integrations/mock.ts        mock providers + deterministic demo price history
  components/map/                 interactive SVG map: pan/zoom engine, city artwork, markers, clusters
  components/marketplace/         home page: filter bar, listings + map, grid view, bottom sheet
  components/property/            listing/grid cards, preview, chart, token stats, contract, trade button, art
  components/markets/             sortable markets table
  components/layout/              header (nav, REALTY panel, wallet dialog), ticker tape, footer, logo
  components/ui/                  shadcn-style primitives (Button, Badge, Skeleton, Change)
  app/                            routes: /, /property/[slug], /markets, /about, loading, error, 404
```

## Swapping in real data

- Token identity: fill `mintAddress`, `pumpFunUrl`, `imageUrl` on each `TokenIdentity` in `data/properties.ts` (or load them from an API in `lib/data.ts`).
- Market data: implement `MarketDataProvider` against Pump.fun / an indexer and set `source: "live"`. The UI labels anything whose `source` is `"demo"`.
- Wallet: implement `WalletProvider` (Solana wallet adapter). Browsing must keep working without one.
- Trading: `TradingProvider.enabled` is the literal `false` today; the trade button stays disabled until that changes.

## Notes

- Property art, logo and map are original SVG. No Rockstar assets are used.
- The brand name and location names (Dynasty 8, Eclipse Towers, Maze Bank, Vinewood, etc.) are Rockstar trademarks used as placeholders. Rename before any public launch.
- Property tokens do not grant ownership of buildings, rental income or in-game property rights.
