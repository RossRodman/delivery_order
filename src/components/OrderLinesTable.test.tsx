// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrderLinesTable } from "./OrderLinesTable";
import type { CatalogProduct } from "@/contracts/api";
import type { EditableLine } from "@/client/hooks/useOrder";

afterEach(cleanup);

const PRODUCTS: CatalogProduct[] = [
  { id: "battery", sku: "BATT-03", name: "Battery", unitPriceCents: 100_000, updatedAt: "2026-01-01" },
];

describe("OrderLinesTable — review M-2 (price drop makes a discount invalid)", () => {
  it("renders an actionable error row instead of crashing when a line has no matching computed entry", () => {
    // Simulates useOrder excluding this line from `computedLines` because, at the current
    // (lowered) catalog price, its discount (150,000) now exceeds the line value (100,000).
    const lines: EditableLine[] = [
      { id: "line-1", productId: "battery", qty: 1, discountCents: 150_000, approval: { status: "none", terms: null } },
    ];

    expect(() =>
      render(<OrderLinesTable lines={lines} computedLines={[]} products={PRODUCTS} readOnly={false} />),
    ).not.toThrow();

    expect(screen.getByText(/Discount \(\$1,500\) exceeds the new line value \(\$1,000\)/)).toBeInTheDocument();
    expect(screen.getByText("Invalid")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Battery")).toBeInTheDocument();
  });

  it("still renders a normal valid line correctly (no regression)", () => {
    const lines: EditableLine[] = [
      { id: "line-1", productId: "battery", qty: 1, discountCents: 1_000, approval: { status: "none", terms: null } },
    ];
    render(
      <OrderLinesTable
        lines={lines}
        computedLines={[
          {
            id: "line-1",
            lineValueCents: 100_000,
            lineTotalCents: 99_000,
            discountBasisPoints: 100,
            classification: "sand",
            state: "sand",
          },
        ]}
        products={PRODUCTS}
        readOnly={false}
      />,
    );
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.queryByText("Invalid")).not.toBeInTheDocument();
  });
});
