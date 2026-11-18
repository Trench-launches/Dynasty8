# Dynasty 8: production checklist

State on 2026-11-18. Nothing has been deployed, funded, launched or signed by this project. Each item marked **(you)** needs the owner's own action or authorization; nothing here is done on your behalf.

Done already (verified or tested):
- Squads multisig `BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn` checked on-chain: 2 of 3, autonomous, three members who can all propose, vote and execute.
- Vaults 0/1/2 = fund / ecosystem / operations, recorded in `config/treasury.mainnet.json` and registered in the **local** database.
- Pump.fun accepts the three vaults at 6000/2500/1500, shown by mainnet simulation (update on an existing config, and the full post-launch setup on a fresh coin).
- Signing page `/admin/treasury`: member proposals and votes, plus post-launch fee-sharing setup. Signed-in flow tested locally with a stubbed wallet.
- Fixed: admin sign-in returned 500 once OAuth was configured; Cloudflare branch builds could migrate the production database.
- 226 tests pass; lint, typecheck and `next build` are clean (after merging current `main`).

## A. Decisions (you)

1. **Catalogue:** BOATWORKS (in the current 15) or CROSSTOWN.
2. **D-NATIVE-FEES:** where $DYNASTY's own creator fees go. The prepared config routes them 60/25/15 to the same vaults; they are not counted as buyback revenue unless you decide they should be (a code change).
3. **D-LAUNCH-DEVBUY:** initial buy per coin (0 by default).
4. **Launch wallet:** which Phantom wallet creates the coins. It also signs each coin's fee-sharing setup, and its own creator-vault balance is claimable only by it.
5. **Optional:** a Squads time lock (for example 24 h) via a 2-of-3 config proposal.
6. **Optional:** move one member key to a hardware wallet; keep one key offline as recovery.

## B. Treasury (you)

1. Send 0.001 SOL to Account 2 `FF5mJunnU3Wx216iwnqtaBaANJsUajSvYoMVZ9XoKokH` and to Account 3 `A5optT3YTSHpxvTD4xiD5brxvSG9cKxjCcesZjRSRQPR`. Neither exists on-chain yet; the minimum is 0.00065024 SOL.
2. Re-run `npx tsx --conditions=react-server scripts/verify/check-treasury.ts BF8XcyJ9iMF2fHqRMm8Z9nK44AV322NAKhhEvVRc2Ljn`. All three vaults should exist.

## C. Merge, deploy and hosting (you)

State from the Cloudflare account (owner's notes, 2026-11-18):
- Worker `dynasty8` on the **free** Workers plan serves dynasty15.xyz. The domain is at Namecheap with Cloudflare nameservers. Pushes to `main` deploy; other branches make preview builds.
- [PR #12](https://github.com/Trench-launches/Dynasty8/pull/12) merged as 5052bf5, and its `main` build failed at `npm ci` ("Missing: diff@9.0.0 from lock file"). #16 re-synced the lock file, and `main` (a2ae60a, with #16 and #17) is live and working.
- [PR #18](https://github.com/Trench-launches/Dynasty8/pull/18) failed with the same lock-file error because its branch predated #16. `main` is now merged into it (3af5130). Its lock file is `main`'s, and `npm ci` passes locally.
- Until #18 is merged, **every build, previews included, runs `db:migrate` and `db:seed` against production Supabase**. #18's own builds already use the guard: Cloudflare sets `WORKERS_CI=1` and `WORKERS_CI_BRANCH` on every build, and `scripts/db-task.mjs` skips both steps unless the branch is `main`.

Steps:
1. Review PR #18 and check its new Cloudflare preview build passes. Its log should show `[db-task] Skipping "migrate"` and `Skipping "seed"`.
2. Take a database backup (`docs/DEPLOYMENT.md` → Backups), then merge #18. The `main` build migrates (nothing new in #18), seeds and deploys.
3. Confirm in the production database (`_prisma_migrations`) that `20261118095539_multisig_proposals_fee_sharing` is applied. Earlier branch builds and the #12 merge build probably applied it; it is additive.
4. **Workers plan:** `docs/DEPLOYMENT.md` says the app needs Workers Paid (the free plan allows 10 ms CPU per request). Watch for CPU-limit errors on server-rendered pages and admin calls, and upgrade if they appear.
5. **Supabase:** the free org has an over-quota warning; projects are restricted from **28 Nov** unless usage drops. Reduce usage or upgrade before then, or the site and fund jobs lose their database.
6. **Account security:** turn on 2FA for the Trench-launches Cloudflare login, and add a second Administrator so there is more than one way in.
7. Make the `DATABASE_URL` **build variable** a Secret (it is plain text today).
8. Optional, recommended: give preview builds their own database, or a build command without database steps.
9. Lock-file hygiene: regenerate `package-lock.json` only on a branch cut from current `main`, and check it with `npm ci --dry-run` before pushing. Lock files rebuilt elsewhere (as on #12) can drift from what Cloudflare's `npm ci` accepts.

## D. Production configuration (you)

1. GitHub OAuth app plus Worker secrets `GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (`docs/DEPLOYMENT.md` → GitHub OAuth).
2. Keyed `SOLANA_RPC_URL` as a Worker secret. The public RPC rate-limits; reads and simulations need a real provider.
3. `CRON_SECRET` is **not set** (the background jobs are off), and `SOLANA_RPC_URL` is **not set** (the public RPC is used). Set both as Worker secrets. `JUPITER_API_KEY` is optional.
4. Do **not** set `FUND_ALLOW_SINGLE_SIG` in production.
5. Grant yourself admin: `npm run admin:grant -- --github-id <id> --login <login> --role ADMIN` against the production database.
6. Register the treasury against production: `npm run fund:register -- --config config/treasury.mainnet.json --check`, then without `--check`.
7. Sign in at `https://dynasty15.xyz/admin/treasury`, connect Phantom and check the page shows the multisig, the three vaults and "you".

## E. Launch $DYNASTY (you; live transactions)

1. Square logo artwork (the bundled logo is 1024×515).
2. Launch on pump.fun from the launch wallet using `config/launch/dynasty.mainnet.json` (name Dynasty, symbol DYNASTY, description, website).
3. `POST /api/admin/ecosystem/token {mintAddress}`, review, then `POST /api/admin/tokens/{id}/verify`.
4. `/admin/treasury` → "Fee sharing for a launched coin" → mint → review → sign with the launch wallet. Only if D-NATIVE-FEES says so.
5. Run `npm run sync:markets` (or wait for the cron), so buybacks see a fresh DYNASTY market snapshot.

## F. Launch the property coins (you; live transactions; one at a time)

For each coin in `config/launch/properties.mainnet.json` (not BOATWORKS until A1 is decided):

1. Square crop of `public/properties/<slug>-v2.jpg`.
2. Launch on pump.fun from the launch wallet with the config's name, symbol, description and website.
3. `POST /api/admin/properties/<slug>/token {mintAddress, creatorWallet}` → review → `POST /api/admin/tokens/{id}/verify`.
4. `/admin/treasury` → "Fee sharing for a launched coin" → review → sign. This sweeps any waiting fee, creates the config, sets the three vaults at 60/25/15 and locks it.
5. `POST /api/admin/demolition-fund/fee-sharing` (or wait an hour). The coin must show as matching.

## G. First buyback (you; live transactions)

1. When verified fees reach the minimum: an admin plans, quotes and approves a buyback (`/api/admin/demolition-fund/buybacks`).
2. `/admin/treasury` → "Create buyback proposal" (signed by a member) → two members approve → a member executes.
3. The worker settles the purchase from the finalized transaction. Then "Create burn proposal" → approve → execute → the burn is verified.
4. Check `/fund` shows the buyback and burn with Solscan links.

## H. Before calling it production-ready

- Independent security review of the Demolition Fund and signing page, and legal/trademark review of names and disclosures.
- GitHub Actions billing so CI runs.
- Dependency advisories (`docs/DEMOLITION-FUND.md` §17.6): plan the `@solana/web3.js` upgrade that removes `bigint-buffer`.
