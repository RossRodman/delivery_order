import { describe, expect, it } from "vitest";
import type { LineApproval } from "./approval";
import { DomainError } from "./errors";
import type { OrderLineInput } from "./order";
import { canonicalOrderKey, computeOrder, sdgTotal } from "./order";

const none: LineApproval = { status: "none", terms: null };
const l1: OrderLineInput = { id: "l1", productId: "pump", qty: 4, unitPriceCents: 51500, discountCents: 4000, approval: none };
const l2: OrderLineInput = { id: "l2", productId: "filt", qty: 2, unitPriceCents: 81000, discountCents: 7000, approval: none };
const l3Terms = { productId: "batt", qty: 1, unitPriceCents: 207000, discountCents: 15000 };
const l3: OrderLineInput = { id: "l3", ...l3Terms, approval: none };

describe("computeOrder — AC1 at 8,200", () => {
  it("lines 1–2: $3,570 = 29,274,000 SDG, saveable", () => {
    const r = computeOrder({ rate: 8200, lines: [l1, l2] });
    expect(r.totalUsdCents).toBe(357000);
    expect(r.totalSdg).toBe(29274000);
    expect(r.canSave).toBe(true);
    expect(r.blockingLineIds).toEqual([]);
    expect(r.lines.map((l) => [l.discountBasisPoints, l.classification, l.state, l.lineTotalCents])).toEqual([
      [194, "sand", "sand", 202000],
      [432, "red", "red", 155000],
    ]);
  });

  it("with unapproved line 3: blocked, cannot save", () => {
    const r = computeOrder({ rate: 8200, lines: [l1, l2, l3] });
    expect(r.totalUsdCents).toBe(549000);
    expect(r.totalSdg).toBe(45018000);
    expect(r.canSave).toBe(false);
    expect(r.blockingLineIds).toEqual(["l3"]);
    expect(r.lines[2]).toMatchObject({ discountBasisPoints: 725, classification: "blocked", state: "blocked" });
  });

  it("with approved line 3: $5,490 = 45,018,000 SDG, saveable", () => {
    const approvedL3 = { ...l3, approval: { status: "approved" as const, terms: { ...l3Terms } } };
    const r = computeOrder({ rate: 8200, lines: [l1, l2, approvedL3] });
    expect(r.totalUsdCents).toBe(549000);
    expect(r.totalSdg).toBe(45018000);
    expect(r.canSave).toBe(true);
    expect(r.lines[2].state).toBe("approved");
  });

  it("approved line 3 with changed discount is blocked again (AC6)", () => {
    const changed = { ...l3, discountCents: 15100, approval: { status: "approved" as const, terms: { ...l3Terms } } };
    const r = computeOrder({ rate: 8200, lines: [l1, l2, changed] });
    expect(r.canSave).toBe(false);
    expect(r.blockingLineIds).toEqual(["l3"]);
  });

  it("an empty order cannot be saved", () => {
    const r = computeOrder({ rate: 8200, lines: [] });
    expect(r).toMatchObject({ totalUsdCents: 0, totalSdg: 0, canSave: false, blockingLineIds: [] });
  });

  it("throws when a discount exceeds the line value", () => {
    expect(() => computeOrder({ rate: 8200, lines: [{ ...l1, discountCents: 206001 }] })).toThrow(DomainError);
  });
});

describe("sdgTotal (R8)", () => {
  it("matches AC1 and rounds half-up", () => {
    expect(sdgTotal(357000, 8200)).toBe(29274000);
    expect(sdgTotal(549000, 8200)).toBe(45018000);
    expect(sdgTotal(1, 8050)).toBe(81); // 80.50 → 81
    expect(sdgTotal(1, 8049)).toBe(80); // 80.49 → 80
  });
  it("handles the largest allowed order without precision loss", () => {
    // 50 lines × $100,000 × 10,000 qty = 5e12 cents at the max rate.
    expect(sdgTotal(5_000_000_000_000, 100_000)).toBe(5_000_000_000_000_000);
  });
  it("throws on unsafe inputs or results", () => {
    expect(() => sdgTotal(0.5, 8200)).toThrow(DomainError);
    expect(() => sdgTotal(Number.MAX_SAFE_INTEGER, 100_000)).toThrow(DomainError);
  });
});

describe("canonicalOrderKey", () => {
  const base = {
    dealerId: "d1",
    rate: 8200,
    lines: [
      { id: "l1", productId: "pump", qty: 4, discountCents: 4000 },
      { id: "l2", productId: "filt", qty: 2, discountCents: 7000 },
    ],
  };
  it("ignores object key order and extra fields", () => {
    const shuffled = {
      lines: [
        { discountCents: 4000, qty: 4, productId: "pump", id: "l1", clientUnitPriceCents: 1 },
        { qty: 2, id: "l2", discountCents: 7000, productId: "filt" },
      ],
      rate: 8200,
      dealerId: "d1",
    };
    expect(canonicalOrderKey(shuffled)).toBe(canonicalOrderKey(base));
  });
  it("is sensitive to line order and to every field", () => {
    const k = canonicalOrderKey(base);
    expect(canonicalOrderKey({ ...base, lines: [base.lines[1], base.lines[0]] })).not.toBe(k);
    expect(canonicalOrderKey({ ...base, rate: 8201 })).not.toBe(k);
    expect(canonicalOrderKey({ ...base, dealerId: "d2" })).not.toBe(k);
    expect(canonicalOrderKey({ ...base, lines: [{ ...base.lines[0], qty: 5 }, base.lines[1]] })).not.toBe(k);
  });
});
