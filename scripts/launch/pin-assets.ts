/**
 * Pins Dynasty 8 launch images and Pump metadata to IPFS through Pinata. Owner-run, local only.
 *
 *   npx tsx scripts/launch/pin-assets.ts --all                 # dry run (default): no network, no credentials
 *   npx tsx scripts/launch/pin-assets.ts --coin dynasty        # dry run for one coin
 *   PINATA_JWT=... npx tsx scripts/launch/pin-assets.ts --coin dynasty --upload
 *
 * --upload pins (this uses Pinata quota; run it only with the owner's approval), verifies each pin
 * byte-for-byte through the gateway, and records the result in config/launch/ipfs-manifest.json.
 * The JWT is read from the environment and never written anywhere. Gateway: release-plan
 * `metadataGateway` (default https://ipfs.io/ipfs/), override with PINATA_GATEWAY_URL.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pinCoin, planCoin, type CoinAssets, type FetchLike } from "./pinata";

async function main() {
  const { values } = parseArgs({ options: { coin: { type: "string" }, all: { type: "boolean", default: false }, upload: { type: "boolean", default: false } } });
  const dynasty = JSON.parse(readFileSync("config/launch/dynasty.mainnet.json", "utf8")).coin as CoinAssets;
  const props = JSON.parse(readFileSync("config/launch/properties.mainnet.json", "utf8")).coins as CoinAssets[];
  const plan = JSON.parse(readFileSync("config/launch/release-plan.json", "utf8")) as { metadataGateway: string };
  const coins = [dynasty, ...props].filter((c) => values.all || c.slug === values.coin);
  if (!coins.length) throw new Error("Pass --coin <slug> or --all");
  const read = (p: string) => new Uint8Array(readFileSync(p));

  if (!values.upload) {
    console.log(JSON.stringify({ dryRun: true, note: "Nothing uploaded. Add --upload (with PINATA_JWT set and the owner's approval) to pin.", coins: coins.map((c) => planCoin(c, read)) }, null, 2));
    return;
  }
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is not set");
  const gateway = process.env.PINATA_GATEWAY_URL || plan.metadataGateway;
  if (!/^https:\/\/\S+\/ipfs\/$/.test(gateway)) throw new Error("Gateway must look like https://host/ipfs/");
  const manifestPath = "config/launch/ipfs-manifest.json";
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { $comment: "Written by scripts/launch/pin-assets.ts. Verified Pinata pins per coin.", coins: {} };
  for (const c of coins) {
    const pinned = await pinCoin(fetch as unknown as FetchLike, jwt, gateway, c, read);
    manifest.coins[c.slug] = pinned;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`${c.symbol}: metadata ${pinned.metadataUri} (verified)`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
