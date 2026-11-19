/**
 * Pinata pinning for Dynasty 8 launch assets (image + Pump metadata per coin). Runs only on the
 * owner's machine via scripts/launch/pin-assets.ts; the Pinata JWT comes from the PINATA_JWT
 * environment variable and is never sent to the browser or the app server.
 *
 * For each coin:
 *   1. pin the committed 1000x1000 launch image (CIDv0, short URLs keep the launch tx small);
 *   2. build the metadata from the committed config with `image` = gateway URL of that pin;
 *   3. pin the metadata bytes exactly as built;
 *   4. fetch both back through the gateway and require byte-identical SHA-256 hashes and matching
 *      metadata fields, so a mismatch can never reach a launch.
 * `fetch` is injectable so tests never touch the network.
 */
import { createHash } from "node:crypto";

export const PINATA_PIN_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: FormData }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface CoinAssets {
  slug: string;
  symbol: string;
  launchImage: string | null;
  launchImageSha256: string | null;
  metadata: { name: string; symbol: string; description: string; image: string; showName: boolean; createdOn: string; website: string };
  twitter: string | null;
  telegram: string | null;
}

export interface PinnedCoin {
  slug: string;
  imageCid: string;
  imageUrl: string;
  imageSha256: string;
  metadataCid: string;
  metadataUri: string;
  metadataSha256: string;
  verifiedAt: string;
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The exact metadata bytes pinned for a coin (stable key order, trailing newline). */
export function metadataBytes(coin: CoinAssets, imageUrl: string): Uint8Array {
  const m: Record<string, unknown> = { ...coin.metadata, image: imageUrl };
  if (coin.twitter) m.twitter = coin.twitter;
  if (coin.telegram) m.telegram = coin.telegram;
  return new TextEncoder().encode(JSON.stringify(m, null, 2) + "\n");
}

export async function pinFile(fetchFn: FetchLike, jwt: string, bytes: Uint8Array, filename: string, name: string, contentType: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  form.append("pinataOptions", JSON.stringify({ cidVersion: 0 }));
  form.append("pinataMetadata", JSON.stringify({ name }));
  const res = await fetchFn(PINATA_PIN_FILE_URL, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: form });
  if (!res.ok) throw new Error(`Pinata upload of ${name} failed with HTTP ${res.status}`);
  const body = (await res.json()) as { IpfsHash?: string };
  if (!body.IpfsHash || !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(body.IpfsHash)) throw new Error(`Pinata returned no CIDv0 for ${name}`);
  return body.IpfsHash;
}

async function fetchBytes(fetchFn: FetchLike, url: string): Promise<Uint8Array> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Pins one coin's image and metadata and verifies both through the gateway. Throws on any mismatch. */
export async function pinCoin(fetchFn: FetchLike, jwt: string, gateway: string, coin: CoinAssets, readFile: (p: string) => Uint8Array, now = () => new Date()): Promise<PinnedCoin> {
  if (!coin.launchImage || !coin.launchImageSha256) throw new Error(`${coin.symbol}: no approved launch image; nothing pinned`);
  const image = readFile(coin.launchImage);
  if (sha256(image) !== coin.launchImageSha256) throw new Error(`${coin.symbol}: ${coin.launchImage} does not match its committed SHA-256; regenerate the launch configs`);
  const ext = coin.launchImage.endsWith(".png") ? "png" : "jpg";
  const imageCid = await pinFile(fetchFn, jwt, image, `${coin.slug}.${ext}`, `dynasty8-${coin.slug}-image`, ext === "png" ? "image/png" : "image/jpeg");
  const imageUrl = `${gateway}${imageCid}`;
  const meta = metadataBytes(coin, imageUrl);
  const metadataCid = await pinFile(fetchFn, jwt, meta, `${coin.slug}.json`, `dynasty8-${coin.slug}-metadata`, "application/json");
  const metadataUri = `${gateway}${metadataCid}`;
  if (metadataUri.length > 200) throw new Error(`${coin.symbol}: metadata URL longer than Pump's 200-character limit`);

  const gotImage = await fetchBytes(fetchFn, imageUrl);
  if (sha256(gotImage) !== coin.launchImageSha256) throw new Error(`${coin.symbol}: pinned image content differs from the committed image`);
  const gotMeta = await fetchBytes(fetchFn, metadataUri);
  if (sha256(gotMeta) !== sha256(meta)) throw new Error(`${coin.symbol}: pinned metadata differs from what was uploaded`);
  const parsed = JSON.parse(new TextDecoder().decode(gotMeta)) as Record<string, unknown>;
  for (const k of ["name", "symbol", "description", "website", "showName", "createdOn"] as const) {
    if (parsed[k] !== coin.metadata[k]) throw new Error(`${coin.symbol}: pinned metadata field ${k} does not match the config`);
  }
  if (parsed.image !== imageUrl) throw new Error(`${coin.symbol}: pinned metadata points at the wrong image`);
  return { slug: coin.slug, imageCid, imageUrl, imageSha256: coin.launchImageSha256, metadataCid, metadataUri, metadataSha256: sha256(meta), verifiedAt: now().toISOString() };
}

/** What --dry-run reports: no network, no credentials. */
export function planCoin(coin: CoinAssets, readFile: (p: string) => Uint8Array) {
  if (!coin.launchImage || !coin.launchImageSha256) return { slug: coin.slug, symbol: coin.symbol, ready: false, reason: "no approved launch image" };
  const ok = sha256(readFile(coin.launchImage)) === coin.launchImageSha256;
  return { slug: coin.slug, symbol: coin.symbol, ready: ok, image: coin.launchImage, imageSha256: coin.launchImageSha256, metadataPreviewBytes: metadataBytes(coin, "https://ipfs.io/ipfs/<image CID>").length, ...(ok ? {} : { reason: "image does not match committed SHA-256" }) };
}
