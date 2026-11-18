/**
 * Builds the Pump.fun launch configurations for $DYNASTY and the 15 property coins from the
 * launch catalogue (src/data/catalogue.ts) and the confirmed treasury (config/treasury.mainnet.json).
 * It writes JSON only; it launches nothing, creates no mint and signs nothing.
 *
 *   npx tsx scripts/launch-config.ts           # write config/launch/*.mainnet.json
 *   npx tsx scripts/launch-config.ts --check   # fail if the committed files are out of date
 *
 * Owner decisions applied (2026-11-18):
 *   - $DYNASTY creator fees: Option C, 100% to the FUND vault (counted as buyback revenue).
 *   - Property coins: FUND 6000 / ECOSYSTEM 2500 / OPERATIONS 1500.
 *   - CROSSTOWN replaces BOATWORKS; its missing details are flagged, never invented.
 *   - Dev buy: 0.01 SOL per launch, inside the atomic launch transaction.
 *
 * Pump limits checked here: name <= 32 characters, symbol <= 13 (we keep <= 10), 1-10
 * shareholders, unique, each > 0, sum 10000.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CATALOGUE, catalogueDescription, NATIVE_TOKEN, slugify } from "../src/data/catalogue";

export const SITE = "https://dynasty15.xyz";
export const IMAGE_PLACEHOLDER = "REPLACE_WITH_IPFS_URL_OF_launchImage";
/** Owner decision: 0.01 SOL initial buy for every launch. */
export const DEV_BUY_LAMPORTS = "10000000";
const DYNASTY_DESCRIPTION =
  "DYNASTY is the ecosystem token of Dynasty 8, a fan-made GTA VI-inspired property-token catalogue. Creator fees from every property coin, and 100% of DYNASTY's own creator fees, buy back and burn DYNASTY through a public, multisig-controlled Demolition Fund. Not affiliated with Rockstar Games or Take-Two. Speculative digital asset.";
const PROPERTY_DISCLAIMER =
  "Fan-made concept listing in the Dynasty 8 catalogue. Not affiliated with or endorsed by Rockstar Games or Take-Two. Not an official or purchasable GTA VI property. Speculative digital collectible; it does not represent ownership of any real or in-game property.";

/**
 * Catalogue entries whose details the owner has not supplied yet. Nothing is invented for them:
 * the launch tool refuses these coins until the owner approves the missing items.
 */
const AWAITING_OWNER_DETAILS: Record<string, string[]> = {
  CROSSTOWN: [
    "CROSSTOWN artwork: no approved image exists yet (a 1000x1000 launch image is needed at marketing/launch/cross-town-safehouse.jpg).",
    "CROSSTOWN description: only the name, ticker and type are known; the listing uses the neutral placeholder text until the owner approves copy.",
    "CROSSTOWN map placement (region / neighbourhood): not set; the listing stays off the map.",
  ],
};

interface Treasury {
  multisig: string;
  allocationMode: string;
  wallets: { role: string; vaultIndex: number; address: string; shareBps: number }[];
}

export interface CoinLaunchConfig {
  slug: string;
  kind: "NATIVE" | "PROPERTY";
  name: string;
  symbol: string;
  description: string;
  /** Repository path of the source artwork, or null when none is approved yet. */
  image: string | null;
  /** Square 1000x1000 image to upload to IPFS (Pinata), or null when none is approved yet. */
  launchImage: string | null;
  /** SHA-256 of launchImage; the launch tool checks the pinned image against it. */
  launchImageSha256: string | null;
  /** Pump / Metaplex metadata JSON uploaded to IPFS (the pin script fills in `image`). */
  metadata: { name: string; symbol: string; description: string; image: string; showName: true; createdOn: string; website: string };
  website: string;
  twitter: string | null;
  telegram: string | null;
  quote: "SOL";
  /** Initial buy inside the atomic launch, in lamports (owner decision: 0.01 SOL). */
  devBuyLamports: string;
  feeSharing: {
    policy: "PROPERTY_60_25_15" | "DYNASTY_FUND_100";
    shareholders: { role: string; address: string; shareBps: number }[];
    lockAfterSetup: true;
    setup: string;
  };
  registration: string;
  status: "READY_FOR_OWNER_REVIEW" | "PENDING_DECISION";
  pending: string[];
}

const sha256 = (path: string) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);

export function buildLaunchConfigs(treasury: Treasury) {
  const propertyShareholders = treasury.wallets.map((w) => ({ role: w.role, address: w.address, shareBps: w.shareBps }));
  const fund = treasury.wallets.find((w) => w.role === "FUND")!;
  const dynastyShareholders = [{ role: "FUND", address: fund.address, shareBps: 10_000 }];
  const setup =
    "/admin/treasury -> 'Launch a coin': ONE transaction = create_v2 + create_fee_sharing_config + update_fee_shares_v2 (locked) + 0.01 SOL buy, signed by the dedicated launch wallet and a browser-generated mint, so fees reach the treasury from the first trade (needs the project lookup table).";
  const meta = (c: { name: string; symbol: string; description: string; website: string }) => ({
    name: c.name,
    symbol: c.symbol,
    description: c.description,
    image: IMAGE_PLACEHOLDER,
    showName: true as const,
    createdOn: "https://pump.fun",
    website: c.website,
  });
  const dynasty: CoinLaunchConfig = {
    slug: "dynasty",
    kind: "NATIVE",
    name: NATIVE_TOKEN.name,
    symbol: NATIVE_TOKEN.ticker,
    description: DYNASTY_DESCRIPTION,
    image: "public/brand/dynasty15-logo.png",
    launchImage: "marketing/launch/dynasty.png",
    launchImageSha256: sha256("marketing/launch/dynasty.png"),
    metadata: meta({ name: NATIVE_TOKEN.name, symbol: NATIVE_TOKEN.ticker, description: DYNASTY_DESCRIPTION, website: SITE }),
    website: SITE,
    twitter: null,
    telegram: null,
    quote: "SOL",
    devBuyLamports: DEV_BUY_LAMPORTS,
    feeSharing: { policy: "DYNASTY_FUND_100", shareholders: dynastyShareholders, lockAfterSetup: true, setup },
    registration: "POST /api/admin/ecosystem/token {mintAddress} -> PENDING_VERIFICATION, then POST /api/admin/tokens/{id}/verify after review -> LIVE. Buybacks refuse to run until DYNASTY is LIVE with a fresh market snapshot.",
    status: "READY_FOR_OWNER_REVIEW",
    pending: [],
  };
  const properties: CoinLaunchConfig[] = CATALOGUE.map((e) => {
    const slug = slugify(e.name);
    const description = `${catalogueDescription(e)} ${PROPERTY_DISCLAIMER}`;
    const website = `${SITE}/property/${slug}`;
    const pending = AWAITING_OWNER_DETAILS[e.ticker] ?? [];
    const sourceImage = existsSync(`public/properties/${slug}-v2.jpg`) ? `public/properties/${slug}-v2.jpg` : null;
    const launchImage = existsSync(`marketing/launch/${slug}.jpg`) ? `marketing/launch/${slug}.jpg` : null;
    return {
      slug,
      kind: "PROPERTY",
      name: e.name,
      symbol: e.ticker,
      description,
      image: sourceImage,
      launchImage,
      launchImageSha256: launchImage ? sha256(launchImage) : null,
      metadata: meta({ name: e.name, symbol: e.ticker, description, website }),
      website,
      twitter: null,
      telegram: null,
      quote: "SOL",
      devBuyLamports: DEV_BUY_LAMPORTS,
      feeSharing: { policy: "PROPERTY_60_25_15", shareholders: propertyShareholders, lockAfterSetup: true, setup },
      registration: `POST /api/admin/properties/${slug}/token {mintAddress, creatorWallet} -> PENDING_VERIFICATION, then POST /api/admin/tokens/{id}/verify -> LIVE. Only registered mints count toward the fund.`,
      status: pending.length || !launchImage ? "PENDING_DECISION" : "READY_FOR_OWNER_REVIEW",
      pending: pending.length || launchImage ? pending : [`${e.ticker} launch image missing`],
    };
  });
  return { dynasty, properties };
}

/** Problems that would make Pump reject the launch or that break an owner decision. Empty when valid. */
export function validateLaunchConfig(c: CoinLaunchConfig): string[] {
  const issues: string[] = [];
  if ([...c.name].length > 32) issues.push(`${c.symbol}: name longer than 32 characters`);
  if (!/^[A-Z0-9]{1,10}$/.test(c.symbol)) issues.push(`${c.symbol}: symbol must be 1-10 uppercase letters or digits`);
  const h = c.feeSharing.shareholders;
  if (h.length < 1 || h.length > 10) issues.push(`${c.symbol}: 1-10 shareholders required`);
  if (new Set(h.map((x) => x.address)).size !== h.length) issues.push(`${c.symbol}: duplicate shareholder`);
  if (h.some((x) => x.shareBps <= 0)) issues.push(`${c.symbol}: zero share`);
  if (h.reduce((s, x) => s + x.shareBps, 0) !== 10_000) issues.push(`${c.symbol}: shares must sum to 10000`);
  if (c.kind === "NATIVE" && !(h.length === 1 && h[0]!.role === "FUND" && h[0]!.shareBps === 10_000)) issues.push(`${c.symbol}: $DYNASTY must route 100% to the FUND vault (Option C)`);
  if (c.kind === "PROPERTY" && h.map((x) => `${x.role}:${x.shareBps}`).join(",") !== "FUND:6000,ECOSYSTEM:2500,OPERATIONS:1500") issues.push(`${c.symbol}: property coins must use FUND 6000 / ECOSYSTEM 2500 / OPERATIONS 1500`);
  if (c.devBuyLamports !== DEV_BUY_LAMPORTS) issues.push(`${c.symbol}: dev buy must be 0.01 SOL`);
  if (c.status === "READY_FOR_OWNER_REVIEW" && (!c.launchImage || !c.launchImageSha256)) issues.push(`${c.symbol}: ready coins need a launch image`);
  return issues;
}

/** The launch catalogue must hold exactly 15 unique property coins. */
export function validateCatalogue(properties: CoinLaunchConfig[]): string[] {
  const issues: string[] = [];
  if (properties.length !== 15) issues.push(`expected 15 property coins, found ${properties.length}`);
  if (new Set(properties.map((p) => p.symbol)).size !== properties.length) issues.push("duplicate property ticker");
  if (new Set(properties.map((p) => p.slug)).size !== properties.length) issues.push("duplicate property slug");
  return issues;
}

function render(treasury: Treasury) {
  const { dynasty, properties } = buildLaunchConfigs(treasury);
  const head = {
    $comment: "Generated by scripts/launch-config.ts from src/data/catalogue.ts and config/treasury.mainnet.json. Do not edit by hand. Nothing here has been launched.",
    multisig: treasury.multisig,
    allocationMode: treasury.allocationMode,
  };
  const files: Record<string, string> = {
    "config/launch/dynasty.mainnet.json": JSON.stringify({ ...head, coin: dynasty }, null, 2) + "\n",
    "config/launch/properties.mainnet.json": JSON.stringify({ ...head, coins: properties }, null, 2) + "\n",
  };
  for (const c of [dynasty, ...properties]) files[`config/launch/metadata/${c.slug}.json`] = JSON.stringify(c.metadata, null, 2) + "\n";
  files["docs/launch/LAUNCH-CARDS.md"] = launchCards(treasury, [dynasty, ...properties]);
  return files;
}

/** One copy-paste card per coin for the owner, in launch order. */
function launchCards(treasury: Treasury, coins: CoinLaunchConfig[]) {
  const vaults = treasury.wallets.map((w) => `${w.role} ${w.shareBps / 100}% \`${w.address}\``).join(" · ");
  const lines = [
    "# Launch cards",
    "",
    "Generated by `scripts/launch-config.ts`. Do not edit by hand. Nothing here has been launched.",
    "",
    `Property coins (locked at launch): ${vaults}. $DYNASTY (Option C): FUND 100% \`${treasury.wallets.find((w) => w.role === "FUND")!.address}\`. Every launch includes a 0.01 SOL initial buy.`,
    "",
    "For each coin:",
    "1. Upload `launchImage` to IPFS.",
    "2. Put its URL in the metadata file's `image`, and upload the metadata file to IPFS.",
    "3. In `/admin/treasury` → **Launch a coin**: choose the coin, paste the metadata URL, prepare, review and sign in Phantom.",
    "4. Press **Register mint**.",
    "",
  ];
  for (const c of coins) {
    lines.push(
      `## $${c.symbol}: ${c.name}`,
      "",
      `- Status: **${c.status}**${c.pending.length ? ` (${c.pending.join("; ")})` : ""}`,
      `- Launch image: ${c.launchImage ? `\`${c.launchImage}\` (sha256 ${c.launchImageSha256})` : "**missing, owner approval needed**"}`,
      `- Metadata template: \`config/launch/metadata/${c.slug}.json\``,
      `- Website: ${c.website}`,
      `- Registration: ${c.kind === "NATIVE" ? "`POST /api/admin/ecosystem/token`" : `\`POST /api/admin/properties/${c.slug}/token\``} (the signing page's **Register mint** button does this)`,
      `- Description: ${c.description}`,
      "",
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && /launch-config\.ts$/.test(process.argv[1])) {
  const treasury = JSON.parse(readFileSync("config/treasury.mainnet.json", "utf8")) as Treasury;
  const files = render(treasury);
  const { dynasty, properties } = buildLaunchConfigs(treasury);
  const issues = [...[dynasty, ...properties].flatMap(validateLaunchConfig), ...validateCatalogue(properties)];
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else if (process.argv.includes("--check")) {
    const stale = Object.entries(files).filter(([p, body]) => {
      try {
        return readFileSync(p, "utf8").replace(/\r\n/g, "\n") !== body;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(`Out of date: ${stale.map(([p]) => p).join(", ")}. Run npx tsx scripts/launch-config.ts`);
      process.exitCode = 1;
    } else console.log("launch configs up to date");
  } else {
    mkdirSync("config/launch/metadata", { recursive: true });
    mkdirSync("docs/launch", { recursive: true });
    for (const [p, body] of Object.entries(files)) writeFileSync(p, body);
    console.log(`wrote ${Object.keys(files).length} files (${properties.length} properties + DYNASTY)`);
  }
}

export { render as renderLaunchConfigs };
