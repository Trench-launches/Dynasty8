import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");
process.env.LOG_LEVEL = "silent";
process.env.SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
process.env.MARKET_STALE_AFTER_MS = "180000";
// Legacy lifecycle tests run against a single-signature fund; multisig tests register a vault.
process.env.FUND_ALLOW_SINGLE_SIG = "true";
