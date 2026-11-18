/**
 * Builds the Pump.fun launch configurations for $DYNASTY and the 15 property coins from the
 * launch catalogue (src/data/catalogue.ts) and the confirmed treasury (config/treasury.mainnet.json).
 * It writes JSON only; it launches nothing, creates no mint and signs nothing.
 *
 *   npx tsx scripts/launch-config.ts           # write config/launch/*.mainnet.json
 *   npx tsx scripts/launch-config.ts --check   # fail if the committed files are out of date
 *
 * Pump / Metaplex limits checked here: name <= 32 bytes, symbol <= 10, URI <= 200 (set at upload),
 * 1-10 shareholders, unique, each > 0, sum 10000.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CATALOGUE, catalogueDescription, NATIVE_TOKEN, slugify } from "../src/data/catalogue";

export const SITE = "https://dynasty15.xyz";
export const IMAGE_PLACEHOLDER = "REPLACE_WITH_IPFS_URL_OF_launchImage";
const DYNASTY_DESCRIPTION =
  "DYNASTY is the ecosystem token of Dynasty 8, a fan-made GTA VI-inspired property-token catalogue. Creator fees from every property coin buy back and burn DYNASTY through a public, multisig-controlled Demolition Fund. Not affiliated with Rockstar Games or Take-Two. Speculative digital asset.";
const PROPERTY_DISCLAIMER =
  "Fan-made concept listing in the Dynasty 8 catalogue. Not affiliated with or endorsed by Rockstar Games or Take-Two. Not an official or purchasable GTA VI property. Speculative digital collectible; it does not represent ownership of any real or in-game property.";

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
  /** Repository path of the source artwork. */
  image: string;
  /** Square 1000x1000 image to upload to IPFS for Pump (generated from `image`). */
  launchImage: string;
  /** Pump / Metaplex metadata JSON to upload to IPFS (after replacing the image placeholder). */
  metadata: { name: string; symbol: string; description: string; image: string; showName: true; createdOn: string; website: string };
  website: string;
  twitter: string | null;
  telegram: string | null;
  quote: "SOL";
  /** SOL spent on the creator's initial buy at launch. 0 until the owner decides (D-LAUNCH-DEVBUY). */
  devBuySol: number;
  /** The wallet that signs the Pump create AND the fee-sharing setup. Owner fills in before launch. */
  creatorWallet: string | null;
  feeSharing: {
    shareholders: { role: string; address: string; shareBps: number }[];
    lockAfterSetup: true;
    setup: string;
  };
  registration: string;
  status: "READY_FOR_OWNER_REVIEW" | "PENDING_DECISION";
  pending: string[];
}

export function buildLaunchConfigs(treasury: Treasury) {
  const shareholders = treasury.wallets.map((w) => ({ role: w.role, address: w.address, shareBps: w.shareBps }));
  const setup =
    "Preferred: /admin/treasury -> 'Launch a coin': ONE transaction = create_v2 + create_fee_sharing_config + update_fee_shares_v2 (locked), signed by creatorWallet and a browser-generated mint, so fees reach the treasury from the first trade (needs the project lookup table). Fallback: launch on pump.fun, register the mint, then 'Fee sharing for a launched coin' (adds sweep_creator_fee; fees before the switch stay claimable by the creator).";
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
    metadata: meta({ name: NATIVE_TOKEN.name, symbol: NATIVE_TOKEN.ticker, description: DYNASTY_DESCRIPTION, website: SITE }),
    website: SITE,
    twitter: null,
    telegram: null,
    quote: "SOL",
    devBuySol: 0,
    creatorWallet: null,
    feeSharing: { shareholders, lockAfterSetup: true, setup },
    registration: "POST /api/admin/ecosystem/token {mintAddress} -> PENDING_VERIFICATION, then POST /api/admin/tokens/{id}/verify after review -> LIVE. Buybacks refuse to run until DYNASTY is LIVE with a fresh market snapshot.",
    status: "PENDING_DECISION",
    pending: [
      "D-NATIVE-FEES: where DYNASTY's own creator fees go. Configured here as the same 60/25/15 vault split; the backend does not book them as buyback revenue (they would sit in the vaults until the owner decides).",
      "D-LAUNCH-DEVBUY: initial buy size (0 by default).",
      "Official X / Telegram links (optional; add them to the metadata before upload).",
    ],
  };
  const properties: CoinLaunchConfig[] = CATALOGUE.map((e) => {
    const slug = slugify(e.name);
    const pending = ["D-LAUNCH-DEVBUY: initial buy size (0 by default)."];
    const description = `${catalogueDescription(e)} ${PROPERTY_DISCLAIMER}`;
    const website = `${SITE}/property/${slug}`;
    if (e.ticker === "BOATWORKS") pending.unshift("Catalogue decision: BOATWORKS (owner's list of 15, current catalogue) or CROSSTOWN (later brief, reserve list). Do not launch until decided.");
    return {
      slug,
      kind: "PROPERTY",
      name: e.name,
      symbol: e.ticker,
      description,
      image: `public/properties/${slug}-v2.jpg`,
      launchImage: `marketing/launch/${slug}.jpg`,
      metadata: meta({ name: e.name, symbol: e.ticker, description, website }),
      website,
      twitter: null,
      telegram: null,
      quote: "SOL",
      devBuySol: 0,
      creatorWallet: null,
      feeSharing: { shareholders, lockAfterSetup: true, setup },
      registration: `POST /api/admin/properties/${slug}/token {mintAddress, creatorWallet} -> PENDING_VERIFICATION, then POST /api/admin/tokens/{id}/verify -> LIVE. Only registered mints count toward the fund.`,
      status: e.ticker === "BOATWORKS" ? "PENDING_DECISION" : "READY_FOR_OWNER_REVIEW",
      pending,
    };
  });
  return { dynasty, properties };
}

/** Problems that would make Pump reject the launch or the fee-sharing setup. Empty when valid. */
export function validateLaunchConfig(c: CoinLaunchConfig): string[] {
  const issues: string[] = [];
  if (Buffer.byteLength(c.name, "utf8") > 32) issues.push(`${c.symbol}: name longer than 32 bytes`);
  if (!/^[A-Z0-9]{1,10}$/.test(c.symbol)) issues.push(`${c.symbol}: symbol must be 1-10 uppercase letters or digits`);
  const h = c.feeSharing.shareholders;
  if (h.length < 1 || h.length > 10) issues.push(`${c.symbol}: 1-10 shareholders required`);
  if (new Set(h.map((x) => x.address)).size !== h.length) issues.push(`${c.symbol}: duplicate shareholder`);
  if (h.some((x) => x.shareBps <= 0)) issues.push(`${c.symbol}: zero share`);
  if (h.reduce((s, x) => s + x.shareBps, 0) !== 10_000) issues.push(`${c.symbol}: shares must sum to 10000`);
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
    `Treasury shareholders for every coin (locked at launch): ${vaults}.`,
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
      `- Launch image: \`${c.launchImage}\``,
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
  const issues = [dynasty, ...properties].flatMap(validateLaunchConfig);
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
