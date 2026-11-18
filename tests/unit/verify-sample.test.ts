import { describe, expect, it } from "vitest";
import { Keypair, type Connection } from "@solana/web3.js";
import { sampleWithoutReplacement } from "../../scripts/verify/sample";

/** Exactly what `Connection.getProgramAccounts(programId, config)` resolves to: a READ-ONLY array. */
type ProgramAccounts = Awaited<ReturnType<Connection["getProgramAccounts"]>>;

function fakeProgramAccounts(n: number): ProgramAccounts {
  const list = Array.from({ length: n }, () => ({
    pubkey: Keypair.generate().publicKey,
    account: { data: Buffer.alloc(0), executable: false, lamports: 0, owner: Keypair.generate().publicKey },
  }));
  // Frozen like a real read-only result: any in-place sort/shuffle throws in strict mode.
  return Object.freeze(list.map((x) => Object.freeze(x)));
}

describe("sampleWithoutReplacement (regression: TS2339 'sort' on GetProgramAccountsResponse)", () => {
  it("accepts the read-only getProgramAccounts result and never mutates it", () => {
    const found = fakeProgramAccounts(100);
    const before = found.map((x) => x.pubkey.toBase58());
    const sample = sampleWithoutReplacement(found, 40);
    expect(sample).toHaveLength(40);
    expect(found.map((x) => x.pubkey.toBase58())).toEqual(before); // input order untouched
    expect(Object.isFrozen(found)).toBe(true);
  });

  it("returns distinct items drawn from the input", () => {
    const found = fakeProgramAccounts(50);
    const keys = new Set(found.map((x) => x.pubkey.toBase58()));
    const sample = sampleWithoutReplacement(found, 50).map((x) => x.pubkey.toBase58());
    expect(new Set(sample).size).toBe(50);
    expect(sample.every((k) => keys.has(k))).toBe(true);
  });

  it("handles n larger than the list, zero, negative and fractional n", () => {
    const found = fakeProgramAccounts(3);
    expect(sampleWithoutReplacement(found, 10)).toHaveLength(3);
    expect(sampleWithoutReplacement(found, 0)).toEqual([]);
    expect(sampleWithoutReplacement(found, -2)).toEqual([]);
    expect(sampleWithoutReplacement(found, 2.9)).toHaveLength(2);
    expect(sampleWithoutReplacement([] as readonly number[], 5)).toEqual([]);
  });

  it("is deterministic with an injected random source", () => {
    const items = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sampleWithoutReplacement(items, 3, () => 0)).toEqual([0, 1, 2]);
    // random() ~ 1 always swaps in the last element: [9,1..8,0] -> [9,0,..,1] -> [9,0,1,..,2]
    expect(sampleWithoutReplacement(items, 3, () => 0.999999)).toEqual([9, 0, 1]);
  });

  it("is unbiased: every position is equally likely to be picked first", () => {
    const items = Object.freeze([0, 1, 2, 3, 4]);
    let seed = 42;
    const rng = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 20_000; i++) counts[sampleWithoutReplacement(items, 1, rng)[0]!]!++;
    for (const c of counts) expect(Math.abs(c - 4_000)).toBeLessThan(400); // within 10%
  });
});
