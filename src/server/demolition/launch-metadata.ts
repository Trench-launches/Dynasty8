import "server-only";
import { createHash } from "node:crypto";
import { ApiError } from "@/server/http/responses";

/**
 * Verifies a coin's pinned Pump metadata before a launch is prepared, so a wrong or tampered
 * metadata file can never be launched:
 *   - the metadata URL is https and within Pump's 200-character limit;
 *   - its JSON has exactly the committed name, symbol, description, website, showName, createdOn;
 *   - its `image` is an https URL whose bytes hash to the committed launch image's SHA-256.
 * Fetching is injectable for tests. Nothing here talks to Pinata or holds credentials.
 */
export interface FetchedResource {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
}
export type ResourceFetcher = (url: string, maxBytes: number) => Promise<FetchedResource>;

const defaultFetcher: ResourceFetcher = async (url, maxBytes) => {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error(`resource larger than ${maxBytes} bytes`);
  return { ok: res.ok, status: res.status, bytes: buf };
};

let fetcherOverride: ResourceFetcher | null = null;
export function setResourceFetcherForTests(f: ResourceFetcher | null) {
  fetcherOverride = f;
}

export interface ExpectedMetadata {
  symbol: string;
  metadata: { name: string; symbol: string; description: string; website: string; showName: boolean; createdOn: string };
  launchImageSha256: string | null;
}

export interface VerifiedMetadata {
  uri: string;
  metadataSha256: string;
  imageUrl: string;
  imageSha256: string;
}

const fail = (msg: string) => new ApiError(422, "UNPROCESSABLE", `Metadata verification failed: ${msg}`);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) && u.length <= 200;

export async function verifyPinnedMetadata(coin: ExpectedMetadata, uri: string): Promise<VerifiedMetadata> {
  if (!isHttps(uri)) throw fail("the metadata URL must be an https URL of at most 200 characters");
  if (!coin.launchImageSha256) throw fail(`${coin.symbol} has no approved launch image`);
  const get = fetcherOverride ?? defaultFetcher;
  let meta: FetchedResource;
  try {
    meta = await get(uri, 64 * 1024);
  } catch (e) {
    throw fail(`could not fetch the metadata (${e instanceof Error ? e.message : "network error"})`);
  }
  if (!meta.ok) throw fail(`metadata URL returned HTTP ${meta.status}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(meta.bytes));
  } catch {
    throw fail("metadata is not valid JSON");
  }
  for (const k of ["name", "symbol", "description", "website", "showName", "createdOn"] as const) {
    if (json[k] !== coin.metadata[k]) throw fail(`"${k}" does not match the committed launch config`);
  }
  if (!isHttps(json.image)) throw fail('"image" must be an https URL');
  let img: FetchedResource;
  try {
    img = await get(json.image, 10 * 1024 * 1024);
  } catch (e) {
    throw fail(`could not fetch the image (${e instanceof Error ? e.message : "network error"})`);
  }
  if (!img.ok) throw fail(`image URL returned HTTP ${img.status}`);
  const imageSha256 = sha256(img.bytes);
  if (imageSha256 !== coin.launchImageSha256) throw fail(`image content does not match ${coin.symbol}'s committed launch image (sha256 ${imageSha256})`);
  return { uri, metadataSha256: sha256(meta.bytes), imageUrl: json.image, imageSha256 };
}
