# $DYNASTY and property-coin launch workflow

Branch `launch/preparation` (draft PR #19, stacked on PR #18). **Nothing has been launched, funded, signed, broadcast, uploaded or deployed.** "Mainnet simulation" below means a read-only `simulateTransaction` with signature verification off. "Mocked" means automated tests with a simulated chain and gateway.

**Every coin launches individually.** All 16 coins ($DYNASTY and the 15 properties) get their own launch transaction, their own mint registration and their own fee-sharing verification, one at a time, in the order of §5. Nothing launches coins together or in a batch. The default is the **atomic** single transaction (§3), which passes mainnet simulation for every coin. The **fallback** (§3a) is separate transactions, for use only if the atomic transaction cannot be used; it does **not** guarantee fee routing from the first trade.

## 1. Owner decisions (2026-11-18) and how they are implemented

| Decision | Implementation | Evidence |
|---|---|---|
| **$DYNASTY: Option C.** 100% of its own creator fees go to the FUND vault and count as buyback revenue | Launch config `DYNASTY_FUND_100` (FUND 10000 bps). Receipts book $DYNASTY's own mint as 100% buyback in every allocation mode (`receipts.ts`, `NATIVE_FEE_POLICY` in `fee-sharing.ts`). The fee-sharing check expects FUND 100% for $DYNASTY and 60/25/15 for properties. The dashboard reports `dynastyCreatorFeesLamports` and keeps $DYNASTY off the property leaderboard | Mocked: `tests/integration/option-c.test.ts` (9). Mainnet simulation: §4 |
| **CROSSTOWN replaces BOATWORKS** | `src/data/catalogue.ts`: 15 coins including Cross Town Safehouse; BOATWORKS moved, with all its data, to `RESERVE_CANDIDATES`. Configs, metadata and launch cards regenerated | Mocked: `tests/unit/launch-config.test.ts`. CROSSTOWN is **held back** (§6) |
| **Dev buy: 0.01 SOL per launch** | `buy_exact_quote_in_v3` inside the atomic launch, preceded by an idempotent creation of the buyer token account. Min-out is the fresh-curve expectation minus 3%. The size, compute, balance and slippage checks are in §3 | Mocked: `tests/integration/launch.test.ts`. Mainnet simulation: §4 |
| **Dedicated Phantom launch wallet** | `config/launch/release-plan.json` → `launchWallet` (public address). The server refuses every launch and lookup-table request from any other wallet, and refuses everything while it is unset | Mocked: launch tests |
| **Pinata** | `scripts/launch/pin-assets.ts` (local CLI; `PINATA_JWT` from the environment only). The server re-verifies pinned metadata and image hashes before preparing a launch | Mocked: `tests/unit/pinata.test.ts` (5). Dry run executed |
| **Launch order** | Enforced server-side (§5) | Mocked: launch tests |

## 2. Treasury (re-verified on-chain 2026-11-18)

- Squads `BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn`: 2 of 3, members AmAU…, 4EmL…, Cq3E…, autonomous, no time lock.
- FUND vault 0 `3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV`: exists.
- ECOSYSTEM `FF5m…KokH` and OPERATIONS `A5op…RQPR`: **not yet on-chain**. Send each 0.001 SOL.

## 3. The atomic launch transaction

One transaction, signed by the launch wallet and a mint keypair generated in the browser:

1. `SetComputeUnitLimit` (800,000), plus an optional `SetComputeUnitPrice` (50,000 µ-lamports/CU, dropped automatically if the transaction would exceed 1,232 bytes).
2. `create_v2`: Token-2022 mint and bonding curve; creator = launch wallet.
3. `create_fee_sharing_config`.
4. `update_fee_shares_v2`: property coins FUND 6000 / ECOSYSTEM 2500 / OPERATIONS 1500; $DYNASTY FUND 10000. The admin is revoked here, so the split is **locked**.
5. Create the launch wallet's token account for the new mint (idempotent).
6. `buy_exact_quote_in_v3`: spend exactly 0.01 SOL, receive at least the fresh-curve amount minus 3%.

Checks:

| Item | Value |
|---|---|
| Size | Mainnet simulation: property coins 1,204–1,217 bytes, $DYNASTY 1,134 bytes (limit 1,232), with a 67-character CIDv0 metadata URL. Longer URLs are refused before signing. If a launch would not fit, the optional priority-fee instruction is dropped first; if it still does not fit, the server refuses and the fallback (§3a) is the only option |
| Lookup table | The project table holds 29 accounts: Pump, Pump Fees, AMM and Mayhem programs and PDAs, fee config, buyback-fee recipient, WSOL, token programs, and the launch wallet's WSOL account and Pump volume accumulator. Prepared by `POST …/launch/lookup-table` as 1–2 transactions; **not created on-chain** |
| Compute | Mainnet simulation with dev buy: 309k–370k CU (limit 800k) |
| Token allocation | 0.01 SOL on a fresh curve, fee 125 bps (protocol 95 + creator 30, read from Pump's fee config): estimated 353,134,762,944 raw (about **353,135 tokens**, 6 decimals). The simulation received 353,134,691,458 raw. Min-out 342,540,720,055 (97%). Inside the atomic transaction nobody can trade first, so the price is deterministic |
| Required SOL | The server refuses below 0.06 SOL (0.01 buy + 0.05 buffer). Simulated total cost of one atomic launch about **0.025 SOL** (0.01 buy + rent for the mint, curve, token accounts and the 1 KB sharing config + fees). Later readings in the report drift because the borrowed payer was trading |
| Mint signing | The keypair lives only in the browser tab and signs first; then Phantom signs and sends. The page refuses any transaction whose signers are not exactly {launch wallet, that mint}. The mint secret is never sent, logged or stored |

## 3a. Fallback: separate transactions (only if the atomic launch cannot be used)

Same gates as the atomic launch: launch wallet, owner decisions, release order, verified metadata, registered treasury. Plus an explicit acknowledgment: the API requires `acknowledgeGapRisk: true`, and the page has a checkbox. Each step is built from **live** on-chain state when you sign it:

| Step | Transaction | Signers | Mainnet simulation |
|---|---|---|---|
| 1 | `create_v2` only | launch wallet + browser mint | All 16 coins pass: 886–901 bytes, 102k–121k CU, no lookup table needed (`docs/launch/fallback-simulation-report.json`) |
| (register) | Server records the mint (no transaction) | n/a | n/a |
| 2 | Fee-sharing lock: `sweep_creator_fee` if trading already happened, `create_fee_sharing_config`, `update_fee_shares_v2` (60/25/15, or 100% FUND for $DYNASTY) | launch wallet | Passes on a live coin, including the sweep (`simulate-launch-setup.ts`) |
| 3 | 0.01 SOL buy, priced from the live curve. **Refused until step 2 is verified locked on-chain** with exactly the expected shareholders | launch wallet | Passes on a live coin: 786 bytes, 74k CU; tokens received matched the live-price estimate to 0.00002%; an impossible min-out was rejected |

**What the fallback cannot guarantee:**
- **Fee routing from the first trade.** Between step 1 and step 2, anyone can trade the new coin. Creator fees from those trades go to the **launch wallet's own creator vault, not the treasury**. They are **not** booked as fund revenue, and step 2 sweeps them into that vault before locking. The launch wallet can claim them later; they never count as Demolition Fund revenue. Treasury routing is guaranteed only from step 2 onward.
- **The dev-buy price.** Snipers can buy between steps, so the 0.01 SOL buy may get fewer tokens. If the price moved more than 3% since step 3 was prepared, the buy fails its slippage floor and must be re-prepared (nothing is lost but the network fee).
- **Speed.** The steps are separate Phantom prompts. Do steps 2 and 3 immediately after step 1 confirms; the risk window is as long as that delay.

The same warning is returned by the API (`FALLBACK_GAP_RISK`) and shown in the review dialog.

## 4. Mainnet simulations (read-only)

`npx tsx --conditions=react-server scripts/verify/simulate-launches.ts --out docs/launch/simulation-report.json` (atomic) and `scripts/verify/simulate-fallback.ts` (fallback). Every coin is simulated individually with its own fresh mint. The simulations borrow on-chain lookup tables and a funded recent Pump trader as payer, because the project's table and launch wallet do not exist yet.

| Coin | Policy | Atomic, launch only (bytes / CU) | Atomic + 0.01 SOL buy (bytes / CU) |
|---|---|---|---|
| DYNASTY | FUND 100% | 919 / 264k | 1,134 / 309k |
| 15 properties (incl. CROSSTOWN) | 60/25/15 | 989–1,002 / 239k–304k | 1,204–1,217 / 316k–370k |

All 32 passed. Controls rejected by Pump as required:
- property split summing to 9,999: `InvalidShareTotal` 6014;
- $DYNASTY at 9,999 bps: 6014;
- dev buy with an impossible min-out: Pump error 6042.

CROSSTOWN was simulated with placeholder metadata only, to prove the transaction shape; it stays blocked until its details are approved.

Earlier read-only evidence (still valid):
- `simulate-fee-shares.ts` / `simulate-launch-setup.ts` (vault shareholders accepted).
- `scripts/rehearsal/dynasty-buyback-rehearsal.ts` (swap and burn proposal creation accepted by Squads for the real multisig).
- `read-fee-tiers.ts` (live fee schedule).

## 5. Launch order (enforced by the server)

1. **$DYNASTY.** No property coin can be prepared until $DYNASTY has a registered mint.
2. **One property coin**, which must be listed in `release-plan.json` → `approvedProperties` (empty today, so nothing is approved).
3. **Verify** the actual on-chain fee-sharing configs (`POST /api/admin/demolition-fund/fee-sharing`). $DYNASTY must show FUND 100% and the property 60/25/15, both locked.
4. **One controlled buyback-and-burn** through the 2-of-3 multisig, completed to BURNED.
5. Only then may further properties launch, each individually approved in `approvedProperties`. The server refuses another property while any launched coin's fee-sharing check is not matching, or no buyback has reached BURNED.

## 6. CROSSTOWN: owner approval needed (nothing invented)

Only the name, ticker, type and category exist:

| Field | Value |
|---|---|
| Name | Cross Town Safehouse |
| Ticker | CROSSTOWN |
| Type / category | Safehouse / SAFEHOUSE |

Missing, and flagged for your approval:
- **Artwork:** no image exists. Provide one, saved as `marketing/launch/cross-town-safehouse.jpg` at 1000×1000 (optionally a 3:2 `public/properties/cross-town-safehouse-v2.jpg`).
- **Description:** the listing shows the neutral "proposed listing" text until you approve copy.
- **Map placement:** none; the listing stays off the map.

The launch tool and the pin script refuse CROSSTOWN until these exist and the configs are regenerated (`npx tsx scripts/launch-config.ts`). BOATWORKS stays in any database already seeded; the seed never deletes or edits rows. **Owner/admin action after deploy:** set BOATWORKS to DRAFT (`PATCH /api/admin/properties/brians-boat-works-and-marina`) if it should disappear from the live site.

## 7. Launch wallet: permissions and expected Phantom prompts

The launch wallet is an ordinary Phantom account the owner creates. It is **not** a multisig member and never holds treasury funds.

| It can | It cannot |
|---|---|
| Create coins and sign their one-time fee-sharing setup, after which the split is locked and the wallet has no control over fees | Change any fee split after launch |
| Make the 0.01 SOL buys and hold those tokens | Move treasury money (vaults need 2 of 3 Squads members) |
| Own the launch lookup table, which it can freeze | Approve or execute buybacks (the server rejects it as a member unless it is one) |

No key or seed phrase is ever requested, uploaded, logged or stored by the site or server. Fund it with about 0.07 SOL per coin (0.01 buy + about 0.034 rent and fees + margin); top up between launches.

Expected prompts:

| Step | Phantom shows | Approve only if |
|---|---|---|
| Connect | Connect request from dynasty15.xyz | The site is dynasty15.xyz |
| Lookup table (once) | 1–2 transactions to the Address Lookup Table program; balance change about −0.005 SOL; no token changes | The page's review dialog showed the same table address |
| Fallback, if ever used | Three separate prompts: step 1 (already signed by the mint; creates the coin only), step 2 (fee-sharing lock, about −0.009 SOL rent), step 3 (the 0.01 SOL buy) | Each matches its review dialog; do them back to back |
| Each launch | One transaction already signed by another party (the mint). Balance change about −0.045 SOL (0.01 buy + rent/fees). Receives about 353,000 of the new coin. Programs: Pump, Pump Fees, Compute Budget, Associated Token | Name, symbol, mint and shares match the page's review dialog (which shows the simulation result) |
| Register mint | No Phantom prompt (server API call) | n/a |

## 8. Pinata (prepared; nothing uploaded)

```bash
npx tsx scripts/launch/pin-assets.ts --all          # dry run: no network, no credentials
PINATA_JWT=… npx tsx scripts/launch/pin-assets.ts --coin dynasty --upload
```

Per coin, the script:
1. Pins the committed square image (CIDv0).
2. Builds the metadata from the committed config with `image` = its gateway URL, and pins those exact bytes.
3. Fetches both back and requires identical SHA-256s and matching fields.
4. Records the result in `config/launch/ipfs-manifest.json`.

At launch time the server fetches the metadata URL again and checks name, symbol, description, website, `showName` and `createdOn`, plus the image's SHA-256 against the committed launch image, before building anything.

- The JWT is read from the environment only; it never reaches the browser or the app server.
- Gateway: `https://ipfs.io/ipfs/` (short URLs keep the transaction under the size limit).
- Dry run executed: 15 coins ready, CROSSTOWN not (no artwork).
- `--upload` uses Pinata quota and runs only with your approval.

## 9. Per-launch procedure

1. Merge #18, then #19, and deploy. Register the treasury in production (`npm run fund:register -- --config config/treasury.mainnet.json`).
2. Set `launchWallet` in `release-plan.json` (pull request), and fund the launch wallet.
3. `/admin/treasury` → **Launch a coin → Create** (lookup table), approve the prompts, and keep the table address.
4. `pin-assets.ts --coin dynasty --upload` → copy the metadata URL.
5. **Launch a coin** → $DYNASTY → paste the URL → **Prepare launch**. The server verifies the metadata, checks the order, wallet and balance, and simulates. Review, then **Sign in Phantom**, then **Register mint**, then verify.
6. Add the first property's slug to `approvedProperties` (pull request), pin it, and launch it the same way.
7. Run the fee-sharing check, then one controlled buyback-and-burn to BURNED.
8. Approve and launch each further property individually: one slug, one pin, one launch, one registration and one fee-sharing check at a time.
9. If **Prepare launch** ever refuses because the transaction does not fit, stop and decide whether to use the fallback (§3a) for that coin. Accept the risk checkbox only if the gap risk is acceptable for that launch, then do steps 1 → register → 2 → 3 back to back.
