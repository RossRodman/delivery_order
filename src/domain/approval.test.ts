import { describe, expect, it } from "vitest";
import type { LineTerms } from "./approval";
import { effectiveState, sameTerms } from "./approval";

const blocked: LineTerms = { productId: "p-batt", qty: 1, unitPriceCents: 207000, discountCents: 15000 };
const approved = { status: "approved" as const, terms: { ...blocked } };

describe("sameTerms / effectiveState (R4, AC6)", () => {
  it("identical terms are the same regardless of object identity", () => {
    expect(sameTerms(blocked, { ...blocked })).toBe(true);
  });

  it("a blocked line with a matching approval is 'approved'", () => {
    expect(effectiveState(blocked, approved)).toBe("approved");
  });

  it.each([
    ["productId", { productId: "p-other" }],
    ["qty", { qty: 2, discountCents: 30000 }],
    ["unitPriceCents", { unitPriceCents: 210000 }],
    ["discountCents", { discountCents: 15100 }],
  ])("changing %s voids the approval → blocked", (_field, change) => {
    const changed = { ...blocked, ...change };
    expect(sameTerms(changed, blocked)).toBe(false);
    expect(effectiveState(changed, approved)).toBe("blocked");
  });

  it("pending / rejected / none never count as approved", () => {
    expect(effectiveState(blocked, { status: "pending", terms: null })).toBe("blocked");
    expect(effectiveState(blocked, { status: "rejected", terms: null })).toBe("blocked");
    expect(effectiveState(blocked, { status: "none", terms: null })).toBe("blocked");
    expect(effectiveState(blocked, { status: "approved", terms: null })).toBe("blocked");
  });

  it("non-blocked lines keep their class even if approved", () => {
    const sand: LineTerms = { productId: "p", qty: 4, unitPriceCents: 51500, discountCents: 4000 };
    expect(effectiveState(sand, { status: "approved", terms: sand })).toBe("sand");
    const red: LineTerms = { productId: "p", qty: 2, unitPriceCents: 81000, discountCents: 7000 };
    expect(effectiveState(red, { status: "none", terms: null })).toBe("red");
  });
});
