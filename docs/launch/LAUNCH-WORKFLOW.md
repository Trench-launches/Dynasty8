# $DYNASTY and property-coin launch workflow

Prepared 2026-11-18 on branch `launch/preparation`, stacked on PR #18. **Nothing has been launched, funded, signed or sent.** Every on-chain check below is a read-only `simulateTransaction` (signature verification off) or a read of public accounts.

## 1. Treasury (re-verified 2026-11-18)

| Item | Value |
|---|---|
| Squads multisig | `BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn`: owned by Squads v4, 2 of 3, no config authority, no time lock, next proposal #1 |
| Members (propose, vote, execute) | `AmAU7AEHnBYnvsuKe4SPzX2KB9tKNxMs7UbnMus7Gdi`, `4EmLpWNvKQqifcKxGxGev7rYoGRPkPMyVfxnP6XhuHU2`, `Cq3EGix162DX5DZZbLdDNK9DcggFxhfHUK9yEphtzN5P` |
| Account 1 / vault 0: FUND 60% | `3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV`: exists, 0.001 SOL |
| Account 2 / vault 1: ECOSYSTEM 25% | `FF5mJunnU3Wx216iwnqtaBaANJsUajSvYoMVZ9XoKokH`: **not yet on-chain** |
| Account 3 / vault 2: OPERATIONS 15% | `A5optT3YTSHpxvTD4xiD5brxvSG9cKxjCcesZjRSRQPR`: **not yet on-chain** |

Re-check with `npx tsx --conditions=react-server scripts/verify/check-treasury.ts BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn`.

## 2. Creator-fee model (read from Pump's live fee config)

`scripts/verify/read-fee-tiers.ts` writes `docs/launch/fee-tiers.json`.

| Where the coin trades | Creator fee | Pump protocol fee |
|---|---|---|
| Bonding curve | **0.30% of every trade** | 0.95% |
| PumpSwap after graduation, market cap < 420 SOL | 0.30% | 0.93% |
| PumpSwap, 420 SOL → ~98,000 SOL market cap | 0.95%, stepping down to 0.05% | 0.05% |

SOL-paired coins always use this schedule; `create_v2`'s `creator_fee_bps` only applies to custom quote pairs. With the locked 60/25/15 split, every 100 SOL traded on a bonding curve pays 0.30 SOL in creator fees: **0.18 SOL to the fund (buyback and burn)**, 0.075 SOL to ecosystem and 0.045 SOL to operations. Pump pays each vault directly when anyone runs the permissionless distribute.

**$DYNASTY's own creator fees (decision D-NATIVE-FEES).** The prepared config routes them to the same three vaults at 60/25/15. The backend books creator-fee receipts only for property coins, so $DYNASTY's fees would reach the vaults but not count as buyback revenue. Options:
- **A (recommended):** keep 60/25/15, and later decide whether the fund's share should buy back $DYNASTY (a small code change to count native receipts).
- **B:** route 100% to ECOSYSTEM or OPERATIONS, keeping the fund purely property-funded.
- **C:** route 100% to FUND and count it as buyback revenue (code change).

Until decided, `$DYNASTY` is blocked in the launch tool.

## 3. Can fee sharing be set at creation? Yes: one atomic transaction

Findings:
- `create_v2` takes `creator` explicitly. Fee sharing must be created by the coin's creator (`create_fee_sharing_config`) and then set and locked (`update_fee_shares_v2`), all of which can run in the **same transaction** as `create_v2`.
- With no gap, there is no creator fee to sweep and no window where fees go anywhere but the treasury. The owner's later buys, and everyone else's trades, all route 60/25/15 from the first trade.
- Without a lookup table the transaction is too large (over 1,232 bytes). With a lookup table of the 24 fixed accounts it is 969–1,013 bytes.
- **Simulated for all 16 coins** (`scripts/verify/simulate-launches.ts` → `docs/launch/simulation-report.json`): every one passed `CreateV2 → CreateFeeSharingConfig → UpdateFeeSharesV2` at 242k–291k compute units. A control with a broken split failed with `InvalidShareTotal` (6014).
- The simulation borrowed an existing on-chain lookup table (`Hyif6e…UcyP`) only because ours does not exist yet. For real launches, create the project's own table (one transaction, see §4).

Fallback if the atomic path is ever unavailable: launch on pump.fun, register the mint, then use "Fee sharing for a launched coin" (PR #18). That transaction adds `sweep_creator_fee`; fees earned before the switch stay claimable by the launch wallet.

## 4. Launch workflow (owner, from Phantom)

One-time setup:
1. Decide D-LAUNCH-WALLET. Pick one Phantom wallet with about 0.05 SOL per coin for rent and fees; a fresh wallet used only for launches is cleanest. It is the coin creator, and it signs the launch; it gets **no ongoing control** over fees, because the split is locked in the same transaction.
2. Sign in at `/admin/treasury` (GitHub admin) and connect the launch wallet.
3. **Launch a coin → Create.** Sign the lookup-table transaction: `createLookupTable` + `extendLookupTable`, 24 addresses, about 0.004 SOL rent, moves no funds. The table address is remembered in that browser; keep it somewhere safe.
4. Optional: freeze the table (remove its authority) with Solana tooling so it can never change.

Per coin (`docs/launch/LAUNCH-CARDS.md` has one card each):
1. Upload `marketing/launch/<slug>.jpg` (1000×1000; `dynasty.png` for $DYNASTY) to IPFS.
2. Put its URL in `config/launch/metadata/<slug>.json` → `image`, add X/Telegram links if wanted, and upload that JSON to IPFS.
3. **Launch a coin**: choose the coin, paste the metadata URL, then **Prepare launch**:
   - The browser generates a fresh mint keypair; only its public key goes to the server.
   - The server takes name, symbol and shareholders from the committed config and registered treasury, never from the request.
   - It refuses coins pending a decision, coins already registered, existing mints, a missing lookup table, or a treasury that differs from the config. It **simulates the launch on mainnet** before returning anything.
4. Review the dialog: name, symbol, metadata, mint, the three vaults at 60/25/15, simulation result. Then **Sign in Phantom**:
   - The browser adds the mint's signature first, then Phantom signs and sends.
   - The page refuses any transaction whose signers are not exactly your wallet plus that mint.
5. **Register mint.** This records the mint against the property (or as $DYNASTY), with status PENDING_VERIFICATION. Review it, then `POST /api/admin/tokens/{id}/verify` makes it LIVE.
6. Confirm: `POST /api/admin/demolition-fund/fee-sharing` (or the hourly worker) shows the coin as matching. Solscan should show the sharing config with the three vaults and `admin_revoked = true`.
7. Optional dev buy (D-LAUNCH-DEVBUY): buy on pump.fun afterwards. Its creator fee also routes to the treasury.

New admin API (on this branch):
- `GET /api/admin/demolition-fund/launch` (VIEWER).
- `POST …/launch/lookup-table {authority}` (ADMIN).
- `POST …/launch/prepare {slug, creator, mint, uri, lookupTable}` (ADMIN).

All of them return unsigned transactions only.

## 5. Coin data

`npx tsx scripts/launch-config.ts` generates everything below from `src/data/catalogue.ts` and `config/treasury.mainnet.json`; `--check` verifies it is current.

| File | Content |
|---|---|
| `config/launch/dynasty.mainnet.json`, `properties.mainnet.json` | Name, symbol, description (with the fan-made / not-affiliated / speculative disclaimer), images, website, shareholders, status, pending decisions |
| `config/launch/metadata/<slug>.json` | Pump/Metaplex metadata, ready to upload once `image` is filled in |
| `marketing/launch/<slug>.jpg`, `dynasty.png` | 1000×1000 centre crops of the property art; the logo on brand green |
| `docs/launch/LAUNCH-CARDS.md` | One copy-paste card per coin |

Status: 14 property coins are READY_FOR_OWNER_REVIEW. BOATWORKS (catalogue decision) and $DYNASTY (D-NATIVE-FEES) are PENDING_DECISION, and the launch tool refuses them until the config is regenerated with the decision.

## 6. Buyback-and-burn rehearsal

- **Read-only, on the real multisig** (`scripts/rehearsal/dynasty-buyback-rehearsal.ts` → `docs/launch/rehearsal-report.json`), with a live Pump coin standing in for $DYNASTY:
  - The Jupiter route (0.05 SOL → coin) passed the buyback policy.
  - An unsigned swap proposal at index #1 (851 bytes) and a BurnChecked proposal (534 bytes) were built with member `AmAU…` as creator. **Squads accepted both creations in simulation.**
  - Approve transactions were built for the other two members.
- **Full lifecycle, simulated chain** (`tests/integration/dynasty-rehearsal.test.ts`), using the real multisig address, members, 2-of-3 threshold and vaults:
  1. 3 SOL of creator fees arrive (1.8 / 0.75 / 0.45).
  2. A buyback is planned, quoted and admin-approved.
  3. Member 1 proposes; members 2 and 3 approve, each with a transaction built for their own wallet.
  4. Member 1 executes, and the purchase is settled from the execution.
  5. The burn proposal is approved and executed, and the burn is verified.
  6. The ledger reconciles and the dashboard shows BURN_VERIFIED.

  A single member's early execute is refused.

What remains unrehearsed until real funds exist: execution of a real proposal, and a real Pump distribute into the vaults.

## 7. Owner decisions and actions, in order

Decisions:
1. **Catalogue:** BOATWORKS or CROSSTOWN.
2. **D-NATIVE-FEES:** option A, B or C (§2).
3. **D-LAUNCH-WALLET:** which Phantom wallet launches the coins.
4. **D-LAUNCH-DEVBUY:** dev buy size per coin (0 by default).
5. **Metadata hosting:** IPFS provider (Pinata, nft.storage, Pump's uploader). IPFS is recommended over dynasty15.xyz URLs because IPFS content cannot be changed after launch.
6. **Launch order and pacing:** suggested order is $DYNASTY first (buybacks need it LIVE), then the property coins one at a time.

Actions (each is yours; nothing here has been done):
1. Fund Accounts 2 and 3 with 0.001 SOL each.
2. Merge PR #18, then this branch's PR, once reviewed. Then register the treasury in production (`npm run fund:register -- --config config/treasury.mainnet.json`) and set the OAuth, `SOLANA_RPC_URL` and `CRON_SECRET` secrets (`docs/PRODUCTION-CHECKLIST.md`).
3. Fund the launch wallet; create (and optionally freeze) the lookup table.
4. Upload images and metadata to IPFS.
5. Launch $DYNASTY → register → verify → `npm run sync:markets`.
6. Launch each property coin → register → verify → check fee sharing.
7. First real buyback through the multisig (`docs/PRODUCTION-CHECKLIST.md` §G).
