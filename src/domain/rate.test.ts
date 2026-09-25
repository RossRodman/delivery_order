import { describe, expect, it } from "vitest";
import { checkRate, MAX_RATE, MIN_RATE } from "./rate";

describe("checkRate (R5, AC3)", () => {
  it("refuses 7,999 and accepts 8,000", () => {
    expect(checkRate(7999)).toEqual({ ok: false, code: "RATE_BELOW_MINIMUM" });
    expect(checkRate(MIN_RATE)).toEqual({ ok: true });
    expect(checkRate(8200)).toEqual({ ok: true });
  });
  it("accepts 100,000 and refuses 100,001", () => {
    expect(checkRate(MAX_RATE)).toEqual({ ok: true });
    expect(checkRate(100001)).toEqual({ ok: false, code: "RATE_ABOVE_MAXIMUM" });
  });
  it("refuses non-integers", () => {
    expect(checkRate(8200.5)).toEqual({ ok: false, code: "RATE_NOT_INTEGER" });
    expect(checkRate(Number.NaN)).toEqual({ ok: false, code: "RATE_NOT_INTEGER" });
  });
});
