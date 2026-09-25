import { describe, expect, it } from "vitest";
import { buildLocalSummary } from "./orders";
import type { LocalOrder } from "./db";
import type { Catalog, UserView } from "@/contracts/api";

const CATALOG: Catalog = {
  dealers: [{ id: "dealer-1", name: "Al-Noor Trading", city: "Khartoum" }],
  products: [{ id: "battery", sku: "BATT-03", name: "Battery", unitPriceCents: 100_000, updatedAt: "2026-01-01" }],
  globalRate: 8200,
  fetchedAt: "2026-01-01",
};

const ME: UserView = { id: "user-a", name: "Amina", role: "adviser" };

function localOrder(overrides: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: "order-1",
    userId: ME.id,
    input: { dealerId: "dealer-1", rate: 8200, lines: [{ id: "l1", productId: "battery", qty: 1, discountCents: 1_000 }] },
    server: null,
    syncState: "rejected",
    lastError: null,
    priceChanges: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildLocalSummary — review M-3", () => {
  it("turns a rejected local-only order into a displayable summary", () => {
    const summary = buildLocalSummary(localOrder(), CATALOG, ME);
    expect(summary.id).toBe("order-1");
    expect(summary.dealer.name).toBe("Al-Noor Trading");
    expect(summary.createdBy.name).toBe("Amina");
    expect(summary.totalUsdCents).toBe(99_000);
  });

  it("never throws for a line whose discount exceeds its (lowered) price — M-2 defence in depth", () => {
    const order = localOrder({
      input: {
        dealerId: "dealer-1",
        rate: 8200,
        lines: [{ id: "l1", productId: "battery", qty: 1, discountCents: 150_000 }],
      },
    });
    expect(() => buildLocalSummary(order, CATALOG, ME)).not.toThrow();
    const summary = buildLocalSummary(order, CATALOG, ME);
    expect(summary.totalUsdCents).toBe(0);
  });
});
