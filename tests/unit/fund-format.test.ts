import { describe, expect, it } from "vitest";
import { formatBps, formatFundDate, formatSol, formatTokenAmount, formatTokenCompact, formatUnits } from "@/lib/fund-format";

describe("Demolition Fund amount formatting", () => {
  it("formats lamports as SOL without floating point", () => {
    expect(formatSol("0")).toBe("0 SOL");
    expect(formatSol("1000000000")).toBe("1 SOL");
    expect(formatSol("12350000000")).toBe("12.35 SOL");
    expect(formatSol("2235000000")).toBe("2.235 SOL");
    expect(formatSol("1234567890123456789")).toBe("1,234,567,890.1234 SOL");
    expect(formatSol("14585000000", 2)).toBe("14.58 SOL");
  });

  it("never shows a non-zero amount as zero", () => {
    expect(formatSol("1")).toBe("<0.0001 SOL");
    expect(formatTokenAmount("1", 6)).toBe("<0.01");
  });

  it("handles amounts beyond Number's safe range exactly", () => {
    expect(formatUnits("123456789012345678901234567", 6, 2)).toBe("123,456,789,012,345,678,901.23");
  });

  it("formats token amounts with and without known decimals", () => {
    expect(formatTokenAmount("1284350120000", 6)).toBe("1,284,350.12");
    expect(formatTokenAmount("0", null)).toBe("0");
    expect(formatTokenAmount("5000", null)).toBe("5,000 units");
    expect(formatUnits("not-a-number", 9, 4)).toBe("—");
  });

  it("shortens large token amounts for headline tiles", () => {
    expect(formatTokenCompact("1284350120000", 6)).toBe("1.28M");
    expect(formatTokenCompact("999990000", 6)).toBe("999.99");
    expect(formatTokenCompact("0", null)).toBe("0");
  });

  it("formats basis points and dates deterministically", () => {
    expect(formatBps(6000)).toBe("60%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatFundDate("2026-11-16T19:38:23.000Z")).toBe("16 Nov 2026, 19:38 UTC");
    expect(formatFundDate(null)).toBe("—");
  });
});
