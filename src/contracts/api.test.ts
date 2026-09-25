import { describe, expect, it } from "vitest";
import {
  DecisionBodySchema,
  DemoLoginBodySchema,
  GlobalRateBodySchema,
  OrderInputSchema,
  OrdersListQuerySchema,
  PriceBodySchema,
} from "./api";
import { ERROR_CODES, ERROR_MESSAGES, ERROR_STATUS, isErrorCode } from "./errors";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(100 + n),
  productId: uuid(200),
  qty: 1,
  discountCents: 0,
  ...extra,
});
const order = (extra: Record<string, unknown> = {}) => ({
  dealerId: uuid(1),
  rate: 8200,
  lines: [line(1)],
  ...extra,
});

describe("OrderInputSchema", () => {
  it("accepts a valid order and strips forged fields", () => {
    const parsed = OrderInputSchema.parse(
      order({
        role: "owner",
        createdBy: uuid(9),
        status: "saved",
        lines: [line(1, { unitPriceCents: 1, approval: { status: "approved" }, clientUnitPriceCents: 51500 })],
      }),
    );
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("createdBy");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed.lines[0]).not.toHaveProperty("unitPriceCents");
    expect(parsed.lines[0]).not.toHaveProperty("approval");
    expect(parsed.lines[0].clientUnitPriceCents).toBe(51500);
  });

  it("rejects qty 0 and 10,001; accepts 1 and 10,000", () => {
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { qty: 0 })] })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { qty: 10001 })] })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { qty: 1 })] })).success).toBe(true);
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { qty: 10000 })] })).success).toBe(true);
  });

  it("rejects non-integer and negative amounts", () => {
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { qty: 1.5 })] })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { discountCents: -1 })] })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { discountCents: 40.5 })] })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ rate: 8200.5 })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ rate: "8200" })).success).toBe(false);
  });

  it("accepts 50 lines and rejects 51", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => line(i));
    expect(OrderInputSchema.safeParse(order({ lines: lines(50) })).success).toBe(true);
    expect(OrderInputSchema.safeParse(order({ lines: lines(51) })).success).toBe(false);
  });

  it("rejects duplicate line ids", () => {
    const result = OrderInputSchema.safeParse(order({ lines: [line(1), line(1)] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Duplicate line id");
  });

  it("rejects duplicate line ids that differ only in case and lower-cases ids (review m-1)", () => {
    const id = "abcdef00-0000-4000-8000-000000000001";
    const dup = OrderInputSchema.safeParse(order({ lines: [line(1, { id }), line(2, { id: id.toUpperCase() })] }));
    expect(dup.success).toBe(false);
    const ok = OrderInputSchema.parse(order({ dealerId: uuid(1).toUpperCase(), lines: [line(1, { id: id.toUpperCase() })] }));
    expect(ok.lines[0].id).toBe(id);
    expect(ok.dealerId).toBe(uuid(1));
  });

  it("rejects bad uuids", () => {
    expect(OrderInputSchema.safeParse(order({ dealerId: "nope" })).success).toBe(false);
    expect(OrderInputSchema.safeParse(order({ lines: [line(1, { productId: "x" })] })).success).toBe(false);
  });

  it("lets rate 7,999 pass zod (the domain rejects it with RATE_BELOW_MINIMUM)", () => {
    expect(OrderInputSchema.safeParse(order({ rate: 7999 })).success).toBe(true);
  });

  it("accepts an empty line list (drafts may be empty)", () => {
    expect(OrderInputSchema.safeParse(order({ lines: [] })).success).toBe(true);
  });
});

describe("other bodies", () => {
  it("decision body", () => {
    const terms = { productId: uuid(200), qty: 1, unitPriceCents: 207000, discountCents: 15000 };
    expect(DecisionBodySchema.safeParse({ decision: "approve", expectedTerms: terms }).success).toBe(true);
    expect(DecisionBodySchema.safeParse({ decision: "maybe", expectedTerms: terms }).success).toBe(false);
    expect(DecisionBodySchema.safeParse({ decision: "reject" }).success).toBe(false);
  });
  it("price body rejects 0 and non-integers", () => {
    expect(PriceBodySchema.safeParse({ unitPriceCents: 51500 }).success).toBe(true);
    expect(PriceBodySchema.safeParse({ unitPriceCents: 0 }).success).toBe(false);
    expect(PriceBodySchema.safeParse({ unitPriceCents: 1.5 }).success).toBe(false);
    expect(PriceBodySchema.safeParse({ unitPriceCents: 10_000_001 }).success).toBe(false);
  });
  it("global rate 7,999 passes zod; non-integer fails", () => {
    expect(GlobalRateBodySchema.safeParse({ globalRate: 7999 }).success).toBe(true);
    expect(GlobalRateBodySchema.safeParse({ globalRate: 8000.1 }).success).toBe(false);
  });
  it("demo login accepts only the two roles", () => {
    expect(DemoLoginBodySchema.safeParse({ role: "adviser" }).success).toBe(true);
    expect(DemoLoginBodySchema.safeParse({ role: "admin" }).success).toBe(false);
  });
  it("orders list query coerces limit and validates status", () => {
    expect(OrdersListQuerySchema.parse({ status: "pending_approval", limit: "20" })).toEqual({
      status: "pending_approval",
      limit: 20,
    });
    expect(OrdersListQuerySchema.safeParse({ status: "nope" }).success).toBe(false);
  });
});

describe("error codes", () => {
  it("every code has a status and a message", () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
    expect(isErrorCode("UNAPPROVED_BLOCKED_LINES")).toBe(true);
    expect(isErrorCode("NETWORK")).toBe(false);
  });
});
