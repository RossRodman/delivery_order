import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { classify, discountBasisPoints, lineTotal, lineValue } from "./line";

describe("AC1 worked example lines (plan §3.2)", () => {
  it.each([
    { qty: 4, price: 51500, discount: 4000, value: 206000, bp: 194, cls: "sand", total: 202000 },
    { qty: 2, price: 81000, discount: 7000, value: 162000, bp: 432, cls: "red", total: 155000 },
    { qty: 1, price: 207000, discount: 15000, value: 207000, bp: 725, cls: "blocked", total: 192000 },
  ])("$qty × $price − $discount → $bp bp, $cls, $total", ({ qty, price, discount, value, bp, cls, total }) => {
    expect(lineValue(qty, price)).toBe(value);
    expect(discountBasisPoints(discount, value)).toBe(bp);
    expect(classify(discount, value)).toBe(cls);
    expect(lineTotal(qty, price, discount)).toBe(total);
  });
});

describe("classification boundaries (R3)", () => {
  it("exactly 3.00% is sand, just above is red", () => {
    expect(classify(3000, 100000)).toBe("sand");
    expect(classify(3001, 100000)).toBe("red");
  });
  it("exactly 5.00% is red, 5.01% is blocked", () => {
    expect(classify(5000, 100000)).toBe("red");
    expect(classify(5001, 100000)).toBe("blocked");
  });
  it("5.0001% displays as 5.00% but is blocked (no display rounding in classification)", () => {
    expect(discountBasisPoints(50001, 1000000)).toBe(500);
    expect(classify(50001, 1000000)).toBe("blocked");
  });
  it("zero discount is sand; full discount is blocked", () => {
    expect(classify(0, 100)).toBe("sand");
    expect(classify(100, 100)).toBe("blocked");
    expect(discountBasisPoints(100, 100)).toBe(10000);
  });
});

describe("guards", () => {
  it("rejects discount above value or negative", () => {
    expect(() => lineTotal(1, 100, 101)).toThrow(DomainError);
    expect(() => lineTotal(1, 100, -1)).toThrow(DomainError);
    expect(lineTotal(1, 100, 100)).toBe(0);
  });
  it("rejects qty < 1, non-integer inputs and unsafe products", () => {
    expect(() => lineValue(0, 100)).toThrow(DomainError);
    expect(() => lineValue(1.5, 100)).toThrow(DomainError);
    expect(() => lineValue(1, 0)).toThrow(DomainError);
    expect(() => lineValue(2 ** 30, 2 ** 30)).toThrow(DomainError);
    expect(() => classify(1, 0)).toThrow(DomainError);
    expect(() => discountBasisPoints(0.5, 100)).toThrow(DomainError);
  });
});
