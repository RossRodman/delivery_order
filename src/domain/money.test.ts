import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { divRoundHalfUp, formatPercent, formatRate, formatSdg, formatUsd, parseUsdToCents } from "./money";

describe("divRoundHalfUp", () => {
  it("rounds .49 down and .50 up", () => {
    expect(divRoundHalfUp(149, 100)).toBe(1);
    expect(divRoundHalfUp(150, 100)).toBe(2);
    expect(divRoundHalfUp(1949, 100)).toBe(19);
    expect(divRoundHalfUp(1950, 100)).toBe(20);
  });
  it("is exact for divisible values and symmetric for negatives", () => {
    expect(divRoundHalfUp(2927400000, 100)).toBe(29274000);
    expect(divRoundHalfUp(-150, 100)).toBe(-2);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });
  it("stays exact near the safe-integer limit", () => {
    expect(divRoundHalfUp(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(divRoundHalfUp(Number.MAX_SAFE_INTEGER, 2)).toBe(4503599627370496);
  });
  it("throws on non-integers and bad divisors", () => {
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(DomainError);
    expect(() => divRoundHalfUp(1, 0)).toThrow(DomainError);
    expect(() => divRoundHalfUp(2 ** 53, 3)).toThrow(DomainError);
  });
});

describe("parseUsdToCents", () => {
  it.each([
    ["40", 4000],
    ["40.5", 4050],
    ["40.50", 4050],
    ["1,550", 155000],
    ["1,550.50", 155050],
    [" $70 ", 7000],
    ["0", 0],
    ["0.01", 1],
  ])("parses %j → %i", (input, cents) => {
    expect(parseUsdToCents(input)).toBe(cents);
  });
  it.each(["1e3", "-1", "4.555", "", "abc", "1,55", "40.", ".5", "1.2.3", "NaN", "Infinity", "12,3456"])(
    "rejects %j",
    (input) => {
      expect(parseUsdToCents(input)).toBeNull();
    },
  );
  it("rejects values beyond the safe-integer range", () => {
    expect(parseUsdToCents("99999999999999999")).toBeNull();
  });
});

describe("formatting (design.md §2/§4.4)", () => {
  it("formats USD without decimals for whole dollars, else 2dp", () => {
    expect(formatUsd(202000)).toBe("$2,020");
    expect(formatUsd(155050)).toBe("$1,550.50");
    expect(formatUsd(549000)).toBe("$5,490");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(-4000)).toBe("-$40");
  });
  it("formats SDG, percent and rate", () => {
    expect(formatSdg(29274000)).toBe("29,274,000 SDG");
    expect(formatSdg(45018000)).toBe("45,018,000 SDG");
    expect(formatPercent(194)).toBe("1.94%");
    expect(formatPercent(432)).toBe("4.32%");
    expect(formatPercent(725)).toBe("7.25%");
    expect(formatPercent(500)).toBe("5.00%");
    expect(formatPercent(5)).toBe("0.05%");
    expect(formatRate(8200)).toBe("8,200 SDG/USD");
  });
  it("throws on non-integer input", () => {
    expect(() => formatUsd(1.5)).toThrow(DomainError);
    expect(() => formatSdg(Number.NaN)).toThrow(DomainError);
  });
});
