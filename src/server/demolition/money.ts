/** Integer money helpers. Amounts are bigint base units; percentages are basis points. */

export const BPS = 10_000n;

export interface Split {
  buyback: bigint;
  ecosystem: bigint;
  operations: bigint;
}

/**
 * Splits `amount` by basis points with no lamport lost or created: ecosystem and
 * operations are floored, and the buyback share takes the remainder. Sum is exact.
 */
export function splitByBps(amount: bigint, bps: { buyback: number; ecosystem: number; operations: number }): Split {
  if (amount < 0n) throw new RangeError("amount must be non-negative");
  const total = bps.buyback + bps.ecosystem + bps.operations;
  if (total !== 10_000 || [bps.buyback, bps.ecosystem, bps.operations].some((b) => !Number.isInteger(b) || b < 0)) {
    throw new RangeError("allocation basis points must be non-negative integers summing to 10000");
  }
  const ecosystem = (amount * BigInt(bps.ecosystem)) / BPS;
  const operations = (amount * BigInt(bps.operations)) / BPS;
  return { buyback: amount - ecosystem - operations, ecosystem, operations };
}

/** floor(amount * bps / 10000) */
export function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BPS;
}

export const minBig = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
export const maxBig = (...xs: bigint[]) => xs.reduce((a, b) => (b > a ? b : a));
export const sumBig = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** Parses a provider decimal string ("0.0012") into basis points, rounding up (conservative). */
export function ratioStringToBps(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.ceil(n * 10_000);
}

/** Parses a non-negative integer string into bigint, or null. */
export function parseRawAmount(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) return null;
  return BigInt(value);
}
