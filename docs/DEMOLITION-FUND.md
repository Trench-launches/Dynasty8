# Demolition Fund: Property Tax → $DYNASTY buyback & burn

Built on branch `feature/demolition-fund`, merged into `main`, and completed for mainnet readiness on `integration/demolition-fund-readiness` (2026-11-18, §9 onwards). Nothing here has been deployed, no wallet has been created or funded, and no transaction has been signed or sent. Read-only mainnet checks are listed in §10.

**Status at a glance (2026-11-18):** implemented and locally tested; decoders, PDAs, the Jupiter program and Squads account layouts externally verified read-only against mainnet; **not mainnet-ready** (see §14 blockers).

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

**Required setup per property token:** launch (or convert) each coin with a fee-sharing config whose shareholders are the three treasury vaults at FUND 6000 / ECOSYSTEM 2500 / OPERATIONS 1500 bps (`ON_CHAIN_SPLIT`, recommended, §9), or the FUND alone at 10000 bps (`FUND_SPLITS`), then revoke the admin to lock it. That is the only way fees are attributable per property and payable to a multisig. The worker checks every registered mint's live config against this hourly (§9.3).

**What the backend does:** it never assumes ownership from a ticker or creator label. A fee receipt is booked only when a finalized, successful transaction contains a genuine Pump `DistributeCreatorFeesEvent` for a registered property mint, with the canonical sharing-config PDA, naming the fund as shareholder, **and** the fund's lamport balance actually rose by at least its share. Receipts are keyed `(signature, event index)`, so re-observing a transaction never double-counts.

- **Automatic:** the worker scans the fund wallet's finalized history with a resumable cursor.
- **Manual funding workflow:** an admin submits a distribute transaction signature (`POST /api/admin/demolition-fund/receipts`); it goes through the identical verification. Use this when the distribute crank is run from Pump's UI or by hand.
- Running the distribute crank itself is permissionless and needs only a fee payer; it is not automated in this release (no signer).

Revenue allocation (default 60 / 25 / 15) is recorded per receipt in integer lamports. In `FUND_SPLITS` ecosystem and operations are floored and buyback takes the remainder, so the three always sum to the receipt exactly. In `ON_CHAIN_SPLIT` each share is the exact amount Pump paid that wallet in the same event (§9.1).

## 3. Treasury architecture

| Role | Wallet | Purpose |
|---|---|---|
| FUND | Multisig vault (e.g. Squads) | Pump fee-sharing shareholder; holds buyback SOL; executes swap and burn |
| ECOSYSTEM | Multisig | Receives its 25% directly from Pump (`ON_CHAIN_SPLIT`) or by recorded, verified disbursement (`FUND_SPLITS`) |
| OPERATIONS | Multisig | Receives its 15% the same way |

Separation of duties:

| Step | Who / what |
|---|---|
| Revenue collection | Pump distribute crank (permissionless) → FUND |
| Treasury accounting | Backend, from verified receipts only |
| Buyback approval | `requiredApprovals` distinct admins (creator cannot approve own), then multisig threshold on-chain |
| Proposal construction | Backend builds an unsigned Squads vault transaction + proposal (`propose-swap` / `propose-burn`); a member signs and sends it (§9.2) |
| Swap execution | Multisig members approve; an executor member executes the policy-checked Jupiter instructions |
| Burn execution | Multisig executes the BurnChecked proposal |
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

Safety controls: per-tx cap, daily cap, minimum size, reserve, min liquidity, max price impact, slippage, cooldown, circuit breaker (N consecutive failures, mismatched executions, reconciliation shortfall), emergency pause (any EDITOR can pause, only ADMIN resumes; verification continues while paused), idempotent jobs, single-flight fund pass (transaction-scoped advisory lock, safe with pooled connections), block-height expiry, multisig execution binding (§9.2).

## 5. Accounting and reconciliation

All amounts are `BigInt` columns (lamports / raw token units); database CHECKs enforce bps summing to 10,000, non-negative amounts, `tokensBurned ≤ tokensReceived`, and the singleton config.

Tables: `TreasuryWallet`, `FundConfig`, `FeeReceipt` (unique signature+event), `RevenueAllocation` (one per receipt), `BuybackRequest` (state machine, unique swap signature), `BuybackFunding` (allocation → request), `BuybackApproval` (unique per admin), `ChainTransaction` (every swap/burn/disbursement signature with status, slot, attempt, last-valid height), `Disbursement`, `ReconciliationRun`, plus `AuditLog` for every action. Migration: `prisma/migrations/20261117133901_demolition_fund`. Readiness additions (`20261118095539_multisig_proposals_fee_sharing`): `MultisigProposal` (one live proposal per buyback step, enforced by a partial unique index), `FeeSharingCheck`, multisig fields on `TreasuryWallet`, `allocationMode` on `FundConfig` (its `workerLeaseOwner` / `workerLeaseUntil` columns are unused since the merge in §9.4), and `RevenueAllocation.paidDirect`.

Reconciliation (worker every pass, or `POST …/reconcile`): the fund's on-chain SOL must be ≥ liabilities (unspent buyback allocations + undisbursed ecosystem/operations shares that the fund actually holds; shares Pump paid directly to those wallets are excluded) and its DYNASTY balance ≥ purchased-but-unburned tokens. A shortfall opens the circuit breaker.

## 6. API

Public (no auth, rate-limited, amounts as decimal strings in base units; types in `src/contracts/demolition-fund.ts`):

| Endpoint | Returns |
|---|---|
| `GET /api/demolition-fund/summary` | Total creator fees, allocations, pending buyback, SOL spent, DYNASTY purchased/burned, counts, latest buyback/burn, pause/breaker/reconciliation status; plus `treasury` (mode, last observed balances, reserve, liabilities, owed vs paid-direct shares, wallets with multisig threshold), `pendingActions` (live multisig proposals), `buybacks` (last 20 with verification status) and `feeSharing` (config checks) |
| `GET /api/demolition-fund/history?limit&before` | Receipts, buybacks, burns, disbursements, newest first |
| `GET /api/demolition-fund/properties` | All published properties ranked by verified creator fees contributed; DYNASTY burned attributed pro rata; map position when verified |
| `GET /api/demolition-fund/burns?limit` | Verified burns with their buyback |
| `GET /api/demolition-fund/transactions/{signature}` | What the fund knows about a signature |

Admin (GitHub sign-in, roles, same-origin, audited): `wallets` (GET/PUT, now with `multisigAddress`, `vaultIndex`), `config` (GET/PATCH), `pause`, `circuit`, `receipts` (GET/POST manual), `scan`, `reconcile`, `disbursements` (GET/POST), `buybacks` (GET/POST), `buybacks/{id}/{quote|approve|cancel|swap-proposal|propose-swap|swap-submitted|burn-proposal|propose-burn|burn-submitted|settle}`, `proposals` (GET VIEWER `?buybackId`, POST ADMIN sync with chain), `fee-sharing` (GET VIEWER expected shareholders + last checks, POST ADMIN check now). `propose-*` take `{creator}` (a multisig member with Initiate permission) and return an unsigned transaction.

Worker: `npm run fund:worker` (or `-- --once`).

## 7. Tests

**2026-11-17 (feature branch):** `tests/unit/demolition.test.ts` and `tests/integration/demolition-fund.test.ts`, 61 tests, against a throwaway PostgreSQL with an in-memory chain that encodes byte-exact Pump events, a mocked Jupiter, and a test signer. Whole repository then: 152 passed, 5 live-provider tests skipped.

**2026-11-18 (`integration/demolition-fund-readiness`):** see §12. Whole repository: **194 passed, 0 failed, 5 live-provider tests skipped** (12 files) after merging current `main` (193 before the merge). `npm run lint` clean, `npm run typecheck` (`next typegen && tsc --noEmit`) clean, `next build` succeeds.

No test touched mainnet or devnet. Mocked tests prove the logic, not live execution.

## 8. Deployment requirements (feature-branch list, superseded)

The 2026-11-17 list is replaced by the checklist in §13 and the blockers in §14. Item 5 of that list (Squads proposal tooling) is now implemented; item 7 (Jupiter program) is now verified.

## 9. Mainnet-readiness work (2026-11-18)

Branch `integration/demolition-fund-readiness`, cut from `main` @ f168452, which already contained `feature/demolition-fund` (dd045b4) and `backend/foundation` (cbd45fb). Nothing on those branches was overwritten.

### 9.1 Fee distribution (final design)

The split is **60% buyback & burn / 25% ecosystem / 15% operations**, taken from the owner's brief. The brief said nothing about which mechanism pays the split, so both are implemented. Change the mode only by owner decision. It is `FundConfig.allocationMode`, a column the config API does not edit.

| Mode | Pump shareholders per property | Who pays eco/ops | Ledger |
|---|---|---|---|
| **`ON_CHAIN_SPLIT`** (default, recommended) | FUND 6000, ECOSYSTEM 2500, OPERATIONS 1500 bps, admin revoked | Pump, in the same distribute instruction | buyback = the fund's actual share; eco/ops recorded `paidDirect = true`, never owed by the fund |
| `FUND_SPLITS` | FUND 10000 bps | The fund, by a verified disbursement | `splitByBps` (eco/ops floored, buyback takes the remainder) |

Why `ON_CHAIN_SPLIT` is recommended: the fund never holds ecosystem or operations money, so there is no disbursement step that could be skipped, and every share can be checked on-chain from the event alone.

Receipt rules apply in both modes and use integer lamports (`bigint`) only. A receipt is booked only from a finalized, successful transaction with a genuine `DistributeCreatorFeesEvent` (emit_cpi from the Pump Fees program). The event's mint must be registered and its sharing config must equal the canonical PDA. The fund must be a shareholder exactly once, and the quote must be SOL (null, default or WSOL quote mint). Each role's balance must actually have risen by its share. Receipts are keyed (signature, event index), so they are never double-counted, and an event for one mint can never be attributed to another property. Ignored events are logged with a reason: `fund_not_shareholder`, `unregistered_mint`, `sharing_config_mismatch`, `non_sol_quote`, `duplicate_shareholders`, `zero_amount`. A configured split that differs from the on-chain one is flagged `split_mismatch`.

### 9.2 Squads v4 multisig

- **Registration** (`PUT …/wallets` with `isMultisig`, `multisigAddress`, `vaultIndex`): the vault address must derive from the multisig and index. The multisig account must exist on-chain and is decoded with `@sqds/multisig` 2.1.4. It is rejected if the threshold is below 2, there are too few voters, or no member can initiate or execute. It warns if the threshold equals the member count, a config authority is set (not autonomous) or there is no time lock. Threshold, members and the verification time are stored.
- **Single-sig guard:** buyback create/approve/propose require a verified multisig FUND. A single-sig fund is accepted only when `NODE_ENV ≠ production` **and** `FUND_ALLOW_SINGLE_SIG=true` (tests and local only).
- **Proposal construction** (`propose-swap`, `propose-burn`): builds `vaultTransactionCreate` + `proposalCreate` for the next transaction index. The response is **unsigned**, with the creator member as fee payer. The inner message is the policy-checked Jupiter swap (minus compute-budget instructions) or the BurnChecked. The only inner signer allowed is the vault, and the result must be ≤ 1232 bytes. The backend stores a sha256 of the canonical message. It never signs, sends, approves or executes.
- **Tracking** (worker each pass, or `POST …/proposals`): proposal states run PREPARED → CREATED → APPROVED → EXECUTED, plus REJECTED / CANCELLED / STALE / MISMATCH.
  - An on-chain message that differs from the stored hash becomes **MISMATCH and opens the circuit breaker**.
  - An index taken by another transaction, or a prepared proposal that never appeared, becomes STALE (re-propose).
  - RPC failures leave the state unchanged.
  - One live proposal per buyback step is enforced in the database.
- **Execution binding:** a swap or burn is settled for a multisig fund only if its finalized transaction is a Squads `vault_transaction_execute` of *that* buyback's approved proposal, with the multisig, proposal and transaction accounts matching. A rogue swap or burn, a replayed signature, or a hot-wallet transaction from the fund is rejected and opens the circuit breaker. No backend key can bypass the multisig.
- **Recommended setup (owner decision):** a separate multisig per role (FUND, ECOSYSTEM, OPERATIONS).
  - Threshold 2-of-3 at minimum, 3-of-5 preferred for FUND.
  - Autonomous (no config authority), with a time lock on FUND.
  - Hardware-wallet members, with member sets that do not fully overlap.

### 9.3 Fee-sharing configuration checks

Every hour the worker (or `POST …/fee-sharing`) reads each registered mint's SharingConfig and records the following in `FeeSharingCheck`, auditing any change as `fee_sharing.changed`:

- whether the config exists;
- its status (Active/Paused);
- whether the admin is revoked;
- the shareholders, compared exactly against the expected set for the mode.

A mismatch shows as an issue on the public page. RPC failures skip the token rather than recording a false result.

### 9.4 Worker

`scripts/demolition-worker.ts` runs these steps on each pass:

1. scan the fund wallet;
2. sync proposals;
3. settle swaps and burns;
4. reconcile;
5. run the fee-sharing check (hourly);
6. run the executor (inert without a managed signer).

Since `main` added Cloudflare deployment, the pass is `fundPass()` in `src/server/jobs.ts`. It is run by `npm run fund:worker` and, on Cloudflare, once a minute by the cron tick (`/api/internal/tick`). One pass runs at a time through a transaction-scoped advisory lock (`pg_try_advisory_xact_lock`), which is safe with connection poolers. It replaced both the old session lock and this branch's interim lease (lease module removed). During an RPC outage the scan stops without advancing its cursor.

### 9.5 Frontend (`/fund`)

All figures come from the 5 public endpoints, loaded server-side (`src/lib/fund.ts`, cached for a few seconds):

- the overview, which describes how the split is paid according to the mode;
- the property leaderboard;
- **buyback history**: a table on desktop and cards on mobile, with verification badges (Planned → Awaiting signers → Approved → Purchase confirming / verified → Burn confirming / verified, Cancelled, Failed) and Solscan links;
- **pending multisig actions** ("N of M approvals");
- **cumulative burn chart** (recharts, verified burns only);
- **treasury transparency**: on-chain balance at the last reconciliation, reserve, liabilities, owed vs paid-direct, unburned DYNASTY, wallets with signer counts, and fee-sharing issues.

Before any on-chain activity every value is zero or "not observed yet" and each section has an empty state. Nothing is invented, including in mock mode. Checked in the browser at 1440 and 375 px wide: no horizontal overflow and no console errors.

## 10. External verification (read-only, mainnet-beta, 2026-11-18)

Run with `npx tsx --conditions=react-server scripts/verify/external-checks.ts <pump|jupiter|squads|proposal>`. Nothing is signed or sent.

| Check | Result |
|---|---|
| SharingConfig discriminator + layout | 893,592 live accounts matched by discriminator; a sample of 30 (`scripts/verify/sample-sharing-configs.json`) all decode and derive from `["sharing-config", mint]` |
| `DistributeCreatorFeesEvent` decoder | Real distribute tx `22q8SAMJ8CRQFVQabN1CPrrT9tJd4QQ8V5TfiqFkBMWEPaz9HoS54vhxNLePXPth2zD1JsgHwjm9Utm8BZ6KS7gk` decoded; shareholder amounts match the lamport balance changes exactly; trailing quote mint field found and handled |
| Jupiter program allowlist | Real Swap V2 `/build` responses use `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` and pass the policy |
| Squads v4 account decoding | Real multisig `843JZ1K78MjZ2pgQU7EvPqoFgs6eULi2vtEPvKJafEFM` decoded (threshold, members, permissions, transaction index) |
| Proposal construction | Unsigned swap and burn proposals built against that multisig: 780 and 849 bytes (limit 1232), policy passes |

Not externally verified: a full proposal → approve → execute round trip on a real multisig (it needs member signatures), and a distribute into wallets this project controls.

## 11. Security review and defects fixed

Each defect below was found during this pass, fixed, and covered by a regression test in `tests/integration/demolition-readiness.test.ts`:

1. The scan advanced its cursor during an RPC outage, so receipts could be skipped permanently.
2. The disbursement cap counted ecosystem/operations shares that Pump had already paid directly.
3. The worker's session-level advisory lock was unsafe with a pooled connection (replaced by a transaction-scoped lock in `fundPass`).
4. Proposal sync treated an RPC error, or a different account type at the PDA, as a MISMATCH and opened the circuit (now propagated or STALE).
5. Proposal preparation treated an RPC failure as "not created" and could replace a live proposal (now 503).
6. A non-SOL quote mint in the distribute event was not handled (now ignored with a reason).
7. The overview copy described fund-side splitting even in `ON_CHAIN_SPLIT` mode.
8. Databases seeded before the rename still showed `$REALTY` (the seed now renames an unlaunched native token without a mint).

Also verified by tests:

- forged events (wrong program, no emit_cpi, wrong discriminator) are rejected;
- Token-2022 ATA derivation matches spl-token;
- a creator who is not a member is rejected;
- one live proposal per step;
- rogue and replayed executions are rejected;
- only finalized data is accepted;
- restart safety and pause;
- programs outside the allowlist are rejected;
- admin role enforcement;
- concurrent create/settle.

Dependency note: `@sqds/multisig` pulls in `bigint-buffer` (known advisory on its native binding). The native build was not installed, so the pure-JS path runs. Only `transactionMessageBeet` decoding and instruction builders are used, never with untrusted lengths from outside an on-chain account.

Not done: independent human security review, and an audit of Squads or Pump programs themselves.

## 12. Test results (2026-11-18)

| Suite | Result |
|---|---|
| `tests/integration/demolition-readiness.test.ts` (new) | 33 passed |
| Whole repository (`npx vitest run`), after merging `main` @ 2db0b4d | 194 passed, 0 failed, 5 live skipped |
| `tests/integration/demolition-signing.test.ts` (owner setup, §16) | 11 passed |
| Whole repository after §16 | 205 passed, 0 failed, 5 live skipped; lint, typecheck, build clean |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `next build` | succeeds |
| CI on GitHub | not run: the account's Actions billing is locked |

## 13. Mainnet deployment checklist

Status key: [ ] not done, [x] done.

- [x] Fee split decided (60/25/15)
- [ ] Owner confirms the allocation mode (`ON_CHAIN_SPLIT` recommended)
- [ ] Final property list confirmed (CROSSTOWN vs BOATWORKS, §14)
- [ ] Three Squads multisigs created by the owner, with members on hardware wallets, threshold ≥ 2, autonomous, time lock on FUND
- [ ] Vaults registered via `PUT …/wallets`, with registration warnings reviewed
- [ ] DYNASTY launched; mint registered and verified; market snapshot fresh
- [ ] Each property launched with a locked SharingConfig at the expected shareholders; the fee-sharing check shows every mint matching
- [ ] Keyed `SOLANA_RPC_URL`; `JUPITER_API_KEY`; `BUYBACK_SWAP_PROGRAMS` confirmed
- [ ] `FUND_ALLOW_SINGLE_SIG` unset in production; `NODE_ENV=production`
- [ ] Migrations applied (`prisma migrate deploy`); one fund pass scheduler (Cloudflare cron tick or `npm run fund:worker`); the pass lock makes overlapping runs safe
- [ ] Limits set: per-tx cap, daily cap, minimum, reserve, liquidity, impact, slippage, cooldown
- [ ] A member signing UI exists to sign and send the prepared unsigned proposal transaction
- [ ] A first small buyback rehearsed end to end with owner approval at each step
- [ ] Independent security review and legal review
- [ ] CI running (billing)
- [ ] Automated execution stays off (`autoExecutionEnabled` false, no managed signer)

## 14. Blockers and owners

| Blocker | Owner |
|---|---|
| CROSSTOWN or BOATWORKS in the 15. The owner's list and Jack's catalogue have BOATWORKS; a later brief lists CROSSTOWN, which is kept as a reserve candidate. **Pending: owner decision.** BOATWORKS stays until then. | Owner |
| Confirm the allocation mode (`ON_CHAIN_SPLIT` vs `FUND_SPLITS`) | Owner |
| Multisig members, thresholds and time lock; creating the three multisigs | Owner |
| DYNASTY token launch | Owner |
| Creating each property's locked fee-sharing config with the expected shareholders | Owner |
| RPC and Jupiter API keys | Owner |
| GitHub Actions billing so CI runs | Owner |
| Independent security review; legal and trademark review | Owner |
| Wallet signing UI for members to sign and send prepared proposals | Jack (frontend) |

## 15. Environment template (no secrets)

```
SOLANA_RPC_URL=""                 # keyed mainnet RPC
JUPITER_API_KEY=""                # optional; keyless is 0.5 RPS
BUYBACK_SWAP_PROGRAMS="JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
FUND_WORKER_INTERVAL_MS="60000"
FUND_ALLOW_SINGLE_SIG=""          # never set in production; ignored when NODE_ENV=production
```

Wallet addresses and multisig settings live in the database (`PUT …/wallets`), not in environment variables. No private key is configured anywhere.

## 16. Owner treasury setup: the "Dynasty" multisig (2026-11-18)

### 16.1 On-chain verification (read-only, finalized, mainnet-beta)

`npx tsx --conditions=react-server scripts/verify/check-treasury.ts BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn 3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV`

| Item | Result |
|---|---|
| Multisig account `BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn` | Exists; owner `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (Squads v4) |
| Threshold | 2 of 3 |
| Config authority | none (autonomous: member changes need a 2-of-3 vote) |
| Time lock | 0 seconds (warning: approved transactions can execute immediately) |
| Transaction index | 0 (no proposals yet) |
| Members (all can propose, vote and execute) | `AmAU7AEHnBYnvsuKe4SPzX2KB9tKNxMs7UbnMus7Gdi`, `4EmLpWNvKQqifcKxGxGev7rYoGRPkPMyVfxnP6XhuHU2`, `Cq3EGix162DX5DZZbLdDNK9DcggFxhfHUK9yEphtzN5P` |
| Treasury "Account 1" `3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV` | Is vault **index 0** of this multisig; system-owned account holding 0.001 SOL; no data, not executable |

The backend's treasury policy check passes (threshold ≥ 2, enough voters, initiators and executors).

### 16.2 One multisig, three vaults

The backend supports this. Each role is a separate vault of the same Squads multisig. The database needs only distinct addresses per role, each proposal is built for the fund's own vault index, and settlement accepts only the execution of that buyback's proposal. Tests: `tests/integration/demolition-signing.test.ts`.

| Role | Share | Squads account | Vault index | Address |
|---|---|---|---|---|
| FUND | 60% | Account 1 | 0 | `3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV` |
| ECOSYSTEM | 25% | Account 2 | 1 | `FF5mJunnU3Wx216iwnqtaBaANJsUajSvYoMVZ9XoKokH` |
| OPERATIONS | 15% | Account 3 | 2 | `A5optT3YTSHpxvTD4xiD5brxvSG9cKxjCcesZjRSRQPR` |

Vault addresses are derived from the multisig and the index, so they are fixed. Vaults 1 and 2 have no account on-chain yet (0 SOL).

**Trade-off:** the same three keys control all three treasuries. That gives the owner the control they want, but there is no separation of duties between the fund and the other shares. A compromise of two member keys exposes all three vaults. Separate multisigs remain the stricter option.

**Shared transaction index:** a proposal made for vault 1 or 2 (for example an ecosystem payment) uses the next index. A fund proposal that was prepared but not yet created then becomes STALE (never MISMATCH, never a circuit trip) and is simply prepared again.

### 16.3 What is registered

- `FUND` = vault 0 is registered in the **local development database** with `npm run fund:register -- --role FUND --multisig BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn --vault-index 0`. The script ran the same on-chain checks as the admin API; the result is 2 of 3, verified 2026-11-18.
- No production database exists yet. Run the same command against the production database at deployment, or use `PUT /api/admin/demolition-fund/wallets`.
- **Update 2026-11-18 (owner confirmed the layout):** all three roles are listed in `config/treasury.mainnet.json` and registered locally with `npm run fund:register -- --config config/treasury.mainnet.json`. That command re-derives every vault from the multisig, checks it on-chain, and checks the 6000/2500/1500 split against the fund config before writing anything. Add `--check` to verify without writing.

### 16.4 Signing interface (`/admin/treasury`)

A members-only page (not indexed) where the owner connects Phantom and signs proposals.

- **Wallet:** connect Phantom. The page shows whether the wallet is a member of the fund multisig and its permissions (`GET /api/admin/demolition-fund/multisig?member=`).
- **Create proposals:** "Create buyback proposal" or "Create burn proposal" for buybacks that admins have planned, quoted and approved. A review dialog shows the amount, minimum output, vault, proposal number and threshold; then Phantom signs and sends the unsigned creation transaction.
- **Vote and execute:** "Approve" or "Reject" on active proposals, then "Execute" once the threshold is met (`POST /api/admin/demolition-fund/proposals/{id}/approve|reject|execute`, body `{member}`).
  - Before building anything, the server re-syncs the proposal and re-verifies the on-chain message hash.
  - It checks membership, permission and that the member has not already voted.
  - For execute it also requires on-chain Approved, buybacks not paused, the circuit closed, and the buyback in the right state.
- **Wallet-side checks:** before sending, the page checks the transaction has exactly one signer, the connected wallet, which is also the fee payer. No key, seed phrase or signature ever reaches the server.
- **Approval counting:** the Squads program counts approvals and enforces the threshold. The backend cannot bypass it, and a single wallet cannot approve twice.
- **Access:** GitHub admin sign-in (ADMIN to act, VIEWER to view) plus multisig membership. Members who prefer can use the Squads app instead; sync picks up their votes either way.

Not verified in a browser yet: the signed-in view needs `NEXTAUTH_*` / GitHub OAuth configured and Phantom installed. The server side is covered by 11 integration tests.

### 16.5 Owner actions (each needs the owner's authorization)

1. **Confirm the vault layout:** vault 0 = fund, vault 1 = ecosystem, vault 2 = operations. Optionally add "Account 2" and "Account 3" in the Squads app and check they show `FF5m…KokH` and `A5op…RQPR`.
2. **Make vaults 1 and 2 rent-exempt** by sending each at least 0.00065024 SOL, the rent-exempt minimum read from mainnet on 2026-11-18 (0.001 SOL is fine), as vault 0 already has. Solana rejects a payment that would create an account below the rent-exempt minimum, so a small Pump distribution to an empty vault could fail the whole distribute transaction.
3. **Control:** with 2-of-3, the owner approves alone only by holding two member keys, ideally on separate devices (one on a hardware wallet). The third key is the recovery key; keep it offline and separate.
4. **Optional time lock** (for example 24 hours) via a Squads config proposal approved 2-of-3. It gives time to reject a bad execute, but delays every buyback by that long.
5. **Pump fee sharing per property token:** create the sharing config with shareholders `3wKBqqEkx53ntNQ3UWpJBNH7cxed1VhyYsJ5V1aUKecV` 6000, `FF5mJunnU3Wx216iwnqtaBaANJsUajSvYoMVZ9XoKokH` 2500, `A5optT3YTSHpxvTD4xiD5brxvSG9cKxjCcesZjRSRQPR` 1500. Revoke the admin after checking it. The hourly check flags any difference.
6. **Admin sign-in for the deployed app:** create a GitHub OAuth app, set `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GITHUB_ID` and `GITHUB_SECRET`, then run `npm run admin:grant` for the owner's GitHub account.
7. **Register the wallets in the production database** (§16.3) once it exists.

Unchanged: no deployment, no funding, no buyback, and nothing signed or sent by this work. Automated execution stays off.

Fixed while doing this: `src/server/http/responses.ts` imported `next/navigation` at module load, which crashed every standalone script that loads the API error type, including `npm run fund:worker`. It is now imported lazily inside the route error handler. The worker was run once afterwards: it scanned the vault's history (1 transaction, nothing to book) and reconciled, with execution skipped.

## 17. Production readiness pass (2026-11-18, after the owner confirmed the treasury)

Status key: **implemented** = code merged on the branch; **tested** = automated tests; **verified** = read-only mainnet evidence; **owner** = needs the owner's action or authorization.

### 17.1 Treasury (verified, registered locally)

All three addresses are vaults of `BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn`: 0 = `3wKB…KecV` (fund, 60%), 1 = `FF5m…KokH` (ecosystem, 25%), 2 = `A5op…RQPR` (operations, 15%). The source of truth is `config/treasury.mainnet.json`, and a unit test re-derives each vault from the multisig.

| Account | On-chain (finalized, 2026-11-18) | Action |
|---|---|---|
| Account 1 (vault 0) | Exists, 0.001 SOL, system-owned | none |
| Account 2 (vault 1) | **No account** | **owner:** send ≥ 0.00065024 SOL (0.001 recommended) |
| Account 3 (vault 2) | **No account** | **owner:** send ≥ 0.00065024 SOL (0.001 recommended) |

Funding instructions (the owner sends; this project sends nothing):

1. In Phantom, choose any wallet you control with spare SOL.
2. Send **0.001 SOL** to `FF5mJunnU3Wx216iwnqtaBaANJsUajSvYoMVZ9XoKokH`.
3. Send **0.001 SOL** to `A5optT3YTSHpxvTD4xiD5brxvSG9cKxjCcesZjRSRQPR`.
4. Check with `npx tsx --conditions=react-server scripts/verify/check-treasury.ts BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn`: vaults 1 and 2 should show `exists: true`.

A plain SOL transfer to a vault address is safe: the vault is a Squads PDA, and only the multisig can move funds out. Do not send SOL to the multisig account itself (`BF8X…2Ljn`).

### 17.2 Pump.fun accepts the three vaults at 6000/2500/1500 (verified by simulation)

- **Docs and IDL** (`pump-fun/pump-public-docs`, `idl/pump_fees.json`): shareholders must be non-empty, at most 10, without duplicates, each above 0, summing to 10,000. There is no restriction on program-derived (off-curve) addresses such as Squads vaults.
- **`scripts/verify/simulate-fee-shares.ts`:** simulated `update_fee_shares_v2` with the three vaults on an existing unlocked mainnet sharing config (`3t6r4Nq9eYnJ9g39cnVxTMMcpJ5CDBpfm2gYuEXGP8jS`). It succeeded. A control with operations at 1499 failed with `InvalidShareTotal` (6014), proving the simulation reached Pump's checks.
- **`scripts/verify/simulate-launch-setup.ts`:** simulated the full post-launch transaction (`sweep_creator_fee` → `create_fee_sharing_config` → `update_fee_shares_v2`) on a fresh mainnet coin (`FUrfsyLKNStM2L28ZhiTy11WkwzeCvjZgUaVSBKUpump`) as its creator. It succeeded (about 176k compute units); the same control failed with 6014.
- **Finding:** on a coin that has traded (including a dev buy), `create_fee_sharing_config` fails with `CreatorFeesNotSwept` (6095) unless `sweep_creator_fee` runs first in the same transaction. The setup tool adds the sweep automatically. Fees swept this way go to the creator's own vault, where the creator can claim them; only fees after the switch go to the treasury.

Not covered by simulation: a payout into an *empty* vault (see 17.1), and a live launch.

### 17.3 Launch configuration (implemented, tested; not launched)

`npx tsx scripts/launch-config.ts` generates `config/launch/dynasty.mainnet.json` and `config/launch/properties.mainnet.json` from the catalogue and the treasury config. `--check` verifies they are current, and a unit test enforces Pump's limits and the shareholder split.

| Field | Value |
|---|---|
| Name / symbol | Catalogue name and ticker (all within Pump's 32-byte name / 10-character symbol limits) |
| Description | Catalogue copy + fan-made / not-affiliated / speculative disclaimer |
| Image | `public/properties/<slug>-v2.jpg` (3:2) or `public/brand/dynasty15-logo.png`. **Owner/Jack:** upload a square crop |
| Website | `https://vicecityrealestate.city/property/<slug>` (DYNASTY: the home page) |
| Quote | SOL only (the setup tool refuses other quotes) |
| Dev buy | 0 SOL until decided (D-LAUNCH-DEVBUY) |
| Creator wallet | Left empty: the owner's launch wallet, which must also sign the fee-sharing setup |
| Fee sharing | The three vaults at 6000/2500/1500, locked after setup |
| Status | 14 properties READY_FOR_OWNER_REVIEW; BOATWORKS and DYNASTY PENDING_DECISION |

Per-coin launch process (owner):

1. Launch on pump.fun from the launch wallet with the config's name, symbol, description, square image and website.
2. Register the mint:
   - property coin: `POST /api/admin/properties/{slug}/token {mintAddress, creatorWallet}`;
   - DYNASTY: `POST /api/admin/ecosystem/token {mintAddress}`.

   The token is PENDING_VERIFICATION until reviewed, then `POST /api/admin/tokens/{id}/verify` makes it LIVE.
3. Open `/admin/treasury`, connect the **launch wallet** in Phantom, and under "Fee sharing for a launched coin" enter the mint, review and sign. The server takes the shareholders from the registered vaults, never from the request. It simulates on mainnet before returning anything and refuses unregistered mints, other wallets, locked configs, graduated coins, non-SOL quotes and holder-rewards coins.
4. The hourly fee-sharing check (and `POST …/fee-sharing`) should then report the coin as matching.

Decisions recorded as pending:
- **D-NATIVE-FEES:** where DYNASTY's own creator fees go. The config uses the same 60/25/15 vaults; the backend does not book them as buyback revenue.
- **D-LAUNCH-DEVBUY:** initial buy size.
- **CROSSTOWN or BOATWORKS.**

### 17.4 Defects fixed in this pass (each with a regression test)

1. **Admin sign-in returned 500 for every admin call once GitHub OAuth was configured.** `src/server/auth/admin.ts` wrapped the request in `new NextRequest(req)`, which throws in the Next 16 route runtime ("Cannot read private member #state"). Found while testing the signed-in page against a real Auth.js session. The resolver now passes the parsed cookies and headers to `getToken`. Test: `tests/integration/admin-session.test.ts` (valid cookie → 200; missing, forged or wrong-key → 401; inactive admin → 403).
2. **Cloudflare branch builds could migrate and seed the production database.** Workers Builds runs `npm run db:migrate && npm run db:seed && npm run build:cf` for every pushed branch, using the production `DATABASE_URL`. `db:migrate` and `db:seed` now go through `scripts/db-task.mjs`, which skips them on Workers Builds when `WORKERS_CI_BRANCH` is not `main` (`PRODUCTION_BRANCH` overrides). **Probable past effect:** the branch builds of 0e65898, 6ee156e and 72eaf6d (before this guard) most likely applied migration `20261118095539_multisig_proposals_fee_sharing` (additive: new tables, columns, indexes) and ran the idempotent seed against production. `main`'s later builds succeeded, which is consistent with the migration having applied cleanly. **Owner:** confirm in the Cloudflare build logs or the `_prisma_migrations` table. No rollback is needed for an additive migration that `main` ignores.
3. **Test isolation:** the reset now truncates `MultisigProposal` and `FeeSharingCheck`.

### 17.5 Signed-in flow tested in a browser (local)

A local dev server ran with throwaway Auth.js settings, and a session cookie was minted with Auth.js's own encoder for a test admin (revoked afterwards). Phantom was stubbed to record transactions instead of signing. The flow:

1. Connected as member `AmAU…7Gdi`. The page showed the live 2-of-3 multisig, the three vaults, permissions and "you".
2. A fee-sharing setup from that wallet was refused ("Only the coin's creator wallet…").
3. As the real creator of mainnet coin `FUrf…pump` (registered to STARLET in the **local** database only, reset afterwards), the review showed sweep → create → update, the three vaults at 60/25/15 and a mainnet simulation pass.
4. "Sign in Phantom" handed the 1,033-byte transaction to the wallet. Nothing was sent.

Not tested: real Phantom signing and sending, and a proposal approve/execute against a real on-chain proposal (none exists, and creating one is a live transaction).

### 17.6 Dependency audit (`npm audit --omit=dev`)

29 advisories (20 high). Nearly all are in build tooling (`@opennextjs/*`, `prisma` config, `shadcn`, glob/minimatch/picomatch). The runtime-relevant one is `bigint-buffer` (buffer overflow in `toBigIntLE`), pulled in by `@solana/spl-token` and `@sqds/multisig`. The pure-JS path is used and it only decodes fixed-size on-chain fields. The automatic fix requires `@solana/web3.js` 3 (breaking), so it is deferred and tracked here.

### 17.7 Production checklist

See `docs/PRODUCTION-CHECKLIST.md`.
