# Demolition Fund: Property Tax → $DYNASTY buyback & burn

Built on branch `feature/demolition-fund` and merged into the integrated app on `main`. Nothing here has been deployed, no wallet has been created or funded, and no transaction has been signed or sent.

## 1. Discovery (2026-11-17)

Searched `Desktop/The Cursor`, `Desktop/Claude Project`, `~/floatloop-deploy`, `~/fl-vt`, `~/fl-rehearsal`, `~/Documents` by filename and by code (`createBurnChecked*`, `burnChecked`, `buyback`, `jup.ag`, `collect*CreatorFee`, `creator_vault`). Key files and keypairs (`HANDLE/keys/treasury.json`, `h1so-deployer.json`, `*.pem`, `.env*`) were skipped and not read. Content searches over the very large `Claude Project` tree hit their time limit, so that tree is not exhaustively covered; its matches were analytics/treasury dashboards, not executors.

| Project | Path | Repo / branch | What it is | Class |
|---|---|---|---|---|
| HyperHouse | `The Cursor/meridian` | JayTrades21/hyperhouse, `main` @ d078812 | Pump fee-sharing collection (sweep → distribute), `DistributeCreatorFeesEvent` booking, per-house self-buyback on curve/PumpSwap, Token-2022 burnChecked, record-before-broadcast keeper txs, double-entry ledger. 95 offline tests pass. | **B** |
| GROK BOT buyback | `The Cursor/grokbot-buyback` (+ `.zip`) | not a git repo | Single-token bot: PumpSwap `collect_coin_creator_fee` → Jupiter (lite-api v1) → BurnChecked. Plaintext key = creator wallet, blind-signs Jupiter txs, possible double burn. No tests. | **B** (significant changes) |
| GROK BOT site | `The Cursor/grokbot-solana` | not a git repo, live | Read-only indexer/verifier of buybacks and burns; builds unsigned burns for users. | **C** as executor, reusable as verification patterns |
| LaunchLoop | `The Cursor/launchloop` | Trench-launches/LAUNCHLOOP, `main` | Raydium LaunchLab/CPMM flywheel, strong exact-match signing policy, burn verified by instruction + supply. Ecosystem (many→one) mode unimplemented. 35 offline tests pass. | **B** |
| FloatMesh | `The Cursor/floatmesh` | JayTrades21/floatmesh, `upgrade-funding` | On-chain atomic claim→buy→burn for Float coins. Program closed; Float/LaunchLab only; cannot attach to Pump coins. 59 keeper tests pass. | **C** |

**Decision:** no implementation is reusable as-is for "15 Pump.fun tokens → one native token", and none has safe signing (all use a plaintext hot key or no policy on provider-built transactions). A new module was built in this app, adapting proven pieces:

| Reused from | What | Where now |
|---|---|---|
| meridian `lib/solana/pump.ts` | Pump program ids, sharing-config / creator-vault PDAs, `DistributeCreatorFeesEvent` layout and emit_cpi tag | `src/server/demolition/pump-fees.ts` |
| meridian `lib/solana/keeperTx.ts`, `lib/buyback/service.ts` | Record signature before broadcast; status-guarded transitions; tokens measured from finalized balance deltas | `buyback.ts`, `executor.ts` |
| LaunchLoop `lib/signer/policy.ts` | Exact-match, deny-by-default pre-signing policy | `policy.ts` |
| LaunchLoop `flywheel.ts`, grokbot-solana `classify.js` | Burn verified from parsed (incl. inner) instructions **and** the balance change | `buyback.ts` (`burnedIn`, `settleBurn`) |
| FloatMesh keeper | Expiry only when a tx can no longer land (block height) | `buyback.ts` (`submissionDead`) |

The original projects were not modified.

## 2. Pump.fun creator fees: how revenue reaches the fund

From Pump's official docs (`github.com/pump-fun/pump-public-docs`, read 2026-11-17):

- Creator fees accrue on the bonding curve / canonical PumpSwap pool and are **not paid out automatically**. Someone must run `sweep_creator_fee` and then collect or distribute.
- Without fee sharing, fees pool **per creator wallet** across all of that creator's coins, so they cannot be attributed to a property from the payout alone.
- With **fee sharing** (Pump Fees program `pfeeUxB6…`, `create_fee_sharing_config`, `update_fee_shares_v2`), each coin's creator becomes its own sharing-config PDA `["sharing-config", mint]`, its creator vault is per coin, and `distribute_creator_fees_v2` (permissionless) pays the shareholders and emits `DistributeCreatorFeesEvent { mint, sharing_config, shareholders, distributed }`. Graduated PumpSwap fees are moved into the same vault with `transfer_creator_fees_to_pump_v2`. Only canonical PumpSwap pools pay creator fees.
- The share split can be locked once (`update_fee_shares_v2` revokes the admin).
- The live creator fee rate is not stated in the docs (it was 0 at announcement and is market-cap tiered); read `Global` / `GlobalConfig` / the fee config on-chain before budgeting.

**Required setup per property token:** launch (or convert) each coin with a fee-sharing config whose shareholders include the **Demolition Fund wallet** (ideally 100%, then lock). That is the only way fees are attributable per property and payable to a multisig.

**What the backend does:** it never assumes ownership from a ticker or creator label. A fee receipt is booked only when a finalized, successful transaction contains a genuine Pump `DistributeCreatorFeesEvent` for a registered property mint, with the canonical sharing-config PDA, naming the fund as shareholder, **and** the fund's lamport balance actually rose by at least its share. Receipts are keyed `(signature, event index)`, so re-observing a transaction never double-counts.

- **Automatic:** the worker scans the fund wallet's finalized history with a resumable cursor.
- **Manual funding workflow:** an admin submits a distribute transaction signature (`POST /api/admin/demolition-fund/receipts`); it goes through the identical verification. Use this when the distribute crank is run from Pump's UI or by hand.
- Running the distribute crank itself is permissionless and needs only a fee payer; it is not automated in this release (no signer).

Revenue allocation (configurable, default 60 / 25 / 15) is applied per receipt in integer lamports: ecosystem and operations are floored, buyback takes the remainder, so the three always sum to the receipt exactly.

## 3. Treasury architecture

| Role | Wallet | Purpose |
|---|---|---|
| FUND | Multisig vault (e.g. Squads) | Pump fee-sharing shareholder; holds buyback SOL; executes swap and burn |
| ECOSYSTEM | Multisig | Receives its 25% by recorded, verified disbursement |
| OPERATIONS | Multisig | Receives its 15% the same way |

Separation of duties:

| Step | Who / what |
|---|---|
| Revenue collection | Pump distribute crank (permissionless) → FUND |
| Treasury accounting | Backend, from verified receipts only |
| Buyback approval | `requiredApprovals` distinct admins (creator cannot approve own), then multisig threshold on-chain |
| Swap execution | Multisig executes the policy-checked Jupiter instructions from `swap-proposal` |
| Burn execution | Multisig executes the `burn-proposal` BurnChecked |
| Verification | Backend, finalized transaction by signature |

Signing: the API, worker and frontend hold no keys. `signer.ts` ships only a disabled signer; the automated executor is inert unless the owner sets `autoExecutionEnabled` directly in the database (the API refuses) **and** a managed signer (KMS / signing gateway enforcing `policy.ts`) is wired in. Neither is done.

## 4. Buyback flow (state machine)

```
PLANNED ──quote──▶ QUOTED ──approvals──▶ APPROVED ──signature──▶ SWAP_SUBMITTED ──finalized+verified──▶ SWAP_CONFIRMED
   │                  │                     ▲  │                         │                                  │
   └──────cancel──────┴─────cancel──────────┘  └◀──failed / expired──────┘                       burn-proposal / signature
                                                                                                             ▼
                                                     BURNED ◀──finalized+verified (all tokens)── BURN_SUBMITTED
                                                                  (partial or failed burn → back to SWAP_CONFIRMED, tokens retained)
```

1. **Plan** (`POST …/buybacks`): idempotency key; one active buyback at a time; budget = min(request, verified unreserved buyback revenue, per-tx cap, daily cap remaining, fund SOL − reserve); ≥ minimum size; cooldown since last swap. Reserved FIFO against allocations, so every lamport traces to receipts and properties. Serialised by a Postgres advisory lock.
2. **Quote** (`…/quote`): fresh DYNASTY liquidity snapshot ≥ `minLiquidityUsd`; Jupiter Swap V2 `GET /build`; response validated (mints, exact input, integer amounts, min-out ≥ our slippage floor, route endpoints, addresses); policy: SOL in, DYNASTY out, exact budget, price impact ≤ max, slippage ≤ tolerance, swap program on the allowlist (`BUYBACK_SWAP_PROGRAMS`, default Jupiter v6), only Compute Budget / System (SOL wrap from the fund within budget) / Token / Token-2022 / ATA support instructions, no signer other than the fund.
3. **Approve** (`…/approve`): quote ≤ 10 min old; distinct admins; fund SOL ≥ budget + reserve.
4. **Swap** (`…/swap-proposal` → multisig executes → `…/swap-submitted {signature}`): the proposal is re-built and must not be worse than the approved minimum output.
5. **Settle swap** (worker or `…/settle`): only finalized data. Not found → stays submitted (confirmation delay); dead only when past `lastValidBlockHeight` (executor) or unknown after 5 min (multisig-reported). Failed tx → back to APPROVED, failure counted. Success → tokens received = finalized balance delta for the fund + DYNASTY (≥ approved min-out), SOL spent = fund delta (≤ budget + 0.01 SOL overhead), tx not older than the request. A successful tx that does not match the approval opens the circuit breaker. Unspent budget is released back to pending.
6. **Burn** (`…/burn-proposal` → multisig → `…/burn-submitted`): exactly the purchased, unburned amount; fund must hold it; BurnChecked with the mint's token program (SPL or Token-2022, detected on-chain) and decimals.
7. **Settle burn**: finalized, successful, parsed burn/burnChecked of DYNASTY by the fund (top-level or inner), amount equal to the fund's balance drop and ≤ outstanding. Partial → stays SWAP_CONFIRMED with the remainder; failed → back to SWAP_CONFIRMED with tokens retained; a second swap is impossible from that state.

Safety controls: per-tx cap, daily cap, minimum size, reserve, min liquidity, max price impact, slippage, cooldown, circuit breaker (N consecutive failures, mismatched executions, reconciliation shortfall), emergency pause (any EDITOR can pause, only ADMIN resumes; verification continues while paused), idempotent jobs, single-flight worker lock, block-height expiry.

## 5. Accounting and reconciliation

All amounts are `BigInt` columns (lamports / raw token units); database CHECKs enforce bps summing to 10,000, non-negative amounts, `tokensBurned ≤ tokensReceived`, and the singleton config.

Tables: `TreasuryWallet`, `FundConfig`, `FeeReceipt` (unique signature+event), `RevenueAllocation` (one per receipt), `BuybackRequest` (state machine, unique swap signature), `BuybackFunding` (allocation → request), `BuybackApproval` (unique per admin), `ChainTransaction` (every swap/burn/disbursement signature with status, slot, attempt, last-valid height), `Disbursement`, `ReconciliationRun`, plus `AuditLog` for every action. Migration: `prisma/migrations/20261117133901_demolition_fund`.

Reconciliation (worker every pass, or `POST …/reconcile`): the fund's on-chain SOL must be ≥ liabilities (unspent buyback allocations + undisbursed ecosystem/operations shares) and its DYNASTY balance ≥ purchased-but-unburned tokens. A shortfall opens the circuit breaker.

## 6. API

Public (no auth, rate-limited, amounts as decimal strings in base units; types in `src/contracts/demolition-fund.ts`):

| Endpoint | Returns |
|---|---|
| `GET /api/demolition-fund/summary` | Total creator fees, allocations, pending buyback, SOL spent, DYNASTY purchased/burned, counts, latest buyback/burn, pause/breaker/reconciliation status |
| `GET /api/demolition-fund/history?limit&before` | Receipts, buybacks, burns, disbursements, newest first |
| `GET /api/demolition-fund/properties` | All published properties ranked by verified creator fees contributed; DYNASTY burned attributed pro rata; map position when verified |
| `GET /api/demolition-fund/burns?limit` | Verified burns with their buyback |
| `GET /api/demolition-fund/transactions/{signature}` | What the fund knows about a signature |

Admin (GitHub sign-in, roles, same-origin, audited): `wallets` (GET/PUT), `config` (GET/PATCH), `pause`, `circuit`, `receipts` (GET/POST manual), `scan`, `reconcile`, `disbursements` (GET/POST), `buybacks` (GET/POST), `buybacks/{id}/{quote|approve|cancel|swap-proposal|swap-submitted|burn-proposal|burn-submitted|settle}`.

Worker: `npm run fund:worker` (or `-- --once`).

## 7. Tests (run 2026-11-17)

`tests/unit/demolition.test.ts` and `tests/integration/demolition-fund.test.ts`: 61 tests, all passing, against a throwaway PostgreSQL with an in-memory chain that encodes byte-exact Pump events, a mocked Jupiter, and a test signer. Coverage: receipt verification, allocation math, incorrect mints, duplicate receipts, duplicate requests, failed swaps, failed burns, partial burns, RPC outages, provider timeouts/rate limits, slippage, liquidity, insufficient SOL, invalid token accounts, confirmation delays and expiry, worker restart after a crash between signing and broadcast, reconciliation, emergency pause, unauthorised execution attempts, dashboard figures. Whole repository: 152 passed, 0 failed, 5 live-provider tests skipped.

No test touched mainnet or devnet.

## 8. Deployment requirements and blockers

Before any real buyback:

1. **Final token list.** The brief lists CROSSTOWN; the seeded launch catalogue has BOATWORKS instead. The fund works off registered mints, so either list works once decided.
2. **Fee-sharing setup** for every property coin with the FUND multisig as shareholder (and locked). Coins launched without it pay a per-creator vault; their fees cannot be attributed per property and would need a different (manual, unattributed) workflow.
3. **Multisig** for FUND / ECOSYSTEM / OPERATIONS (e.g. Squads), members and threshold decided by the owner; register addresses via `PUT …/wallets`.
4. **DYNASTY launched and verified** in the registry (buybacks refuse otherwise), with a fresh market snapshot (run `npm run sync:markets`).
5. **Multisig proposal tooling:** the API returns validated instructions; turning them into Squads proposals (e.g. `@sqds/multisig`) is not implemented. Until then members create the transaction in Squads' transaction builder from the proposal JSON.
6. **Keyed RPC** (`SOLANA_RPC_URL`) and optionally `JUPITER_API_KEY` (keyless Jupiter is 0.5 RPS).
7. **Confirm the Jupiter program allowlist.** `JUP6Lkb…` appears in Jupiter's documented v1 examples; v2 `/build` docs do not state the program id. Check a real `/build` response and set `BUYBACK_SWAP_PROGRAMS`.
8. **Read Pump's live fee configuration** on-chain to size expectations.
9. Independent security review, legal review of the buyback/burn programme and its disclosures, and trademark review of names.
10. Unattended execution stays off until a managed signer exists and the owner explicitly approves it.

Fixed along the way: the Token-2022 program id constant on `backend/foundation` was mistyped (invalid key), which would have made mint registration reject every Token-2022 Pump coin. Corrected on this branch, with a regression test.
