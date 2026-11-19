import { describe, expect, it } from "vitest";
import { metadataBytes, pinCoin, planCoin, sha256, type CoinAssets, type FetchLike } from "../../scripts/launch/pinata";

/** Mocked Pinata + gateway: nothing here touches the network or a real Pinata account. */
const IMAGE = new Uint8Array([1, 2, 3, 4, 5]);
const coin: CoinAssets = {
  slug: "starlet-motel",
  symbol: "STARLET",
  launchImage: "marketing/launch/starlet-motel.jpg",
  launchImageSha256: sha256(IMAGE),
  metadata: { name: "Starlet Motel", symbol: "STARLET", description: "d", image: "REPLACE", showName: true, createdOn: "https://pump.fun", website: "https://vicecityrealestate.city/property/starlet-motel" },
  twitter: null,
  telegram: null,
};
const GATEWAY = "https://ipfs.io/ipfs/";
const cid = (n: number) => `Qm${String(n).padStart(44, "a")}`;

function fakePinata(opts: { tamperImage?: boolean; tamperMetadata?: boolean; uploadStatus?: number } = {}) {
  const store = new Map<string, Uint8Array>();
  const uploads: { name: string; auth: string | undefined }[] = [];
  let n = 0;
  const fetchFn: FetchLike = async (url, init) => {
    if (init?.method === "POST") {
      if (opts.uploadStatus) return { ok: false, status: opts.uploadStatus, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      const file = init.body!.get("file") as Blob;
      const meta = JSON.parse(String(init.body!.get("pinataMetadata")));
      expect(JSON.parse(String(init.body!.get("pinataOptions")))).toEqual({ cidVersion: 0 });
      uploads.push({ name: meta.name, auth: init.headers?.Authorization });
      const id = cid(++n);
      store.set(id, new Uint8Array(await file.arrayBuffer()));
      return { ok: true, status: 200, json: async () => ({ IpfsHash: id }), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const id = url.slice(GATEWAY.length);
    let bytes = store.get(id);
    if (!bytes) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (opts.tamperImage && id === cid(1)) bytes = new Uint8Array([9, 9, 9]);
    if (opts.tamperMetadata && id === cid(2)) bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace("Starlet Motel", "Other Coin"));
    const copy = bytes.slice();
    return { ok: true, status: 200, json: async () => JSON.parse(new TextDecoder().decode(copy)), arrayBuffer: async () => copy.buffer };
  };
  return { fetchFn, uploads };
}

describe("Pinata pinning (mocked)", () => {
  it("pins the image then metadata pointing at it, verifies both and returns short CIDv0 URLs", async () => {
    const p = fakePinata();
    const r = await pinCoin(p.fetchFn, "test-jwt", GATEWAY, coin, () => IMAGE);
    expect(r).toMatchObject({ slug: "starlet-motel", imageCid: cid(1), imageUrl: `${GATEWAY}${cid(1)}`, metadataCid: cid(2), metadataUri: `${GATEWAY}${cid(2)}`, imageSha256: sha256(IMAGE) });
    expect(r.metadataUri.length).toBe(67);
    expect(r.metadataSha256).toBe(sha256(metadataBytes(coin, r.imageUrl)));
    expect(p.uploads).toEqual([
      { name: "dynasty8-starlet-motel-image", auth: "Bearer test-jwt" },
      { name: "dynasty8-starlet-motel-metadata", auth: "Bearer test-jwt" },
    ]);
  });

  it("fails when the gateway serves a different image or altered metadata", async () => {
    await expect(pinCoin(fakePinata({ tamperImage: true }).fetchFn, "jwt", GATEWAY, coin, () => IMAGE)).rejects.toThrow(/image content differs/);
    await expect(pinCoin(fakePinata({ tamperMetadata: true }).fetchFn, "jwt", GATEWAY, coin, () => IMAGE)).rejects.toThrow(/metadata differs/);
  });

  it("refuses to pin a coin without approved artwork, or whose image changed since the config was generated", async () => {
    await expect(pinCoin(fakePinata().fetchFn, "jwt", GATEWAY, { ...coin, launchImage: null, launchImageSha256: null }, () => IMAGE)).rejects.toThrow(/no approved launch image/);
    await expect(pinCoin(fakePinata().fetchFn, "jwt", GATEWAY, coin, () => new Uint8Array([7]))).rejects.toThrow(/does not match its committed SHA-256/);
  });

  it("surfaces Pinata upload errors", async () => {
    await expect(pinCoin(fakePinata({ uploadStatus: 401 }).fetchFn, "bad-jwt", GATEWAY, coin, () => IMAGE)).rejects.toThrow(/HTTP 401/);
  });

  it("dry run needs no network or credentials", () => {
    expect(planCoin(coin, () => IMAGE)).toMatchObject({ ready: true, imageSha256: sha256(IMAGE) });
    expect(planCoin({ ...coin, launchImage: null, launchImageSha256: null }, () => IMAGE)).toMatchObject({ ready: false });
  });
});
