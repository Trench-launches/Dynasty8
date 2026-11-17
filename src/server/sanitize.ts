/**
 * Third-party strings (token names, symbols, metadata URLs) are untrusted.
 * They are stored as plain text, trimmed, stripped of control / bidi characters and
 * length-limited; the frontend renders them as text (React escapes), never as HTML.
 */
const CONTROL = new RegExp("[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]", "g");

export function sanitizeText(input: unknown, maxLen: number): string | null {
  if (typeof input !== "string") return null;
  const s = input.replace(CONTROL, "").replace(/[<>]/g, "").trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

/** Accepts only absolute https URLs without credentials. Returns null otherwise. */
export function sanitizeHttpsUrl(input: unknown, maxLen = 500): string | null {
  if (typeof input !== "string" || input.length > maxLen) return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Parses a provider number that may arrive as string. Non-finite or negative becomes null. */
export function finiteNonNegative(input: unknown): number | null {
  const n = typeof input === "string" ? Number(input) : input;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Like finiteNonNegative but allows negatives (percentage changes). */
export function finiteNumber(input: unknown): number | null {
  const n = typeof input === "string" ? Number(input) : input;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}
