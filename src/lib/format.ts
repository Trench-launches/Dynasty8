import { REGION_BY_ID } from "@/data/regions";
import type { Property } from "@/lib/types";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUsdCompact(value: number | null | undefined): string {
  if (value == null) return "—";
  return compactUsd.format(value);
}

/** Token prices are often tiny; show significant digits instead of fixed decimals. */
export function formatPrice(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value === 0) return "$0";
  const exponent = Math.floor(Math.log10(value));
  if (exponent < -4) {
    // $0.0₅123 style: count the zeros after the decimal point
    const zeros = -exponent - 1;
    const digits = (value * 10 ** (zeros + 3)).toFixed(0);
    return `$0.0${toSubscript(zeros)}${digits}`;
  }
  return `$${value.toPrecision(3)}`;
}

function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)])
    .join("");
}

export function formatChange(value: number | null | undefined): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US");
}

export function tickerLabel(p: Pick<Property, "token">): string {
  return p.token.ticker ? `$${p.token.ticker}` : "Ticker TBA";
}

export function locationLabel(p: Pick<Property, "neighbourhood" | "region">): string {
  const region = REGION_BY_ID[p.region]?.name;
  if (!region) return p.neighbourhood;
  if (p.neighbourhood === region) return region.includes("Leonida") ? region : `${region}, Leonida`;
  if (p.neighbourhood.includes(region)) return p.neighbourhood;
  return `${p.neighbourhood}, ${region}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
