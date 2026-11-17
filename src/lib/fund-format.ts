/**
 * Formatting for Demolition Fund amounts. The API sends them as decimal strings in base units
 * (lamports, raw token units) because they can exceed Number's safe range, so everything here
 * works in BigInt and never rounds a non-zero amount down to "0".
 */

const GROUPED = new Intl.NumberFormat("en-US");

/** `raw` base units with `decimals` places, as "1,234.56". Truncates; tiny non-zero amounts show "<0.0001". */
export function formatUnits(raw: string, decimals: number, maxFraction: number): string {
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return "—";
  }
  const negative = value < 0n;
  if (negative) value = -value;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  if (whole === 0n && !fraction && value > 0n) return `<0.${"0".repeat(Math.max(maxFraction - 1, 0))}1`;
  return `${negative ? "-" : ""}${GROUPED.format(whole)}${fraction ? `.${fraction}` : ""}`;
}

export function formatSol(lamports: string, maxFraction = 4): string {
  return `${formatUnits(lamports, 9, maxFraction)} SOL`;
}

/** DYNASTY amounts. Before the token is live its decimals are unknown; every amount is then 0. */
export function formatTokenAmount(raw: string, decimals: number | null): string {
  if (decimals == null) return raw === "0" ? "0" : `${GROUPED.format(BigInt(raw))} units`;
  return formatUnits(raw, decimals, 2);
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** Short form for headline tiles ("1.28M"). Approximate by design; exact figures appear elsewhere. */
export function formatTokenCompact(raw: string, decimals: number | null): string {
  if (decimals == null || raw === "0") return formatTokenAmount(raw, decimals);
  const value = BigInt(raw);
  const whole = value / 10n ** BigInt(decimals);
  if (whole < 1000n) return formatUnits(raw, decimals, 2);
  return COMPACT.format(Number(whole));
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

/** Fixed locale and time zone, so server and browser renders agree. */
export function formatFundDate(iso: string | null): string {
  return iso ? `${DATE.format(new Date(iso))} UTC` : "—";
}

export function isZero(amount: string): boolean {
  return amount === "0";
}
