// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAll } from "@/client/offline/db";
import type { Catalog, OrderInput } from "@/contracts/api";

vi.mock("@/client/api", () => ({
  api: {
    getOrder: vi.fn(),
    catalog: vi.fn(),
    putOrder: vi.fn(),
    saveOrder: vi.fn(),
    requestApproval: vi.fn(),
    withdrawApproval: vi.fn(),
  },
}));

const { api } = await import("@/client/api");
const { useOrder } = await import("./useOrder");

const CATALOG: Catalog = {
  dealers: [{ id: "dealer-1", name: "Al-Noor Trading", city: "Khartoum" }],
  products: [{ id: "prod-1", sku: "PUMP-01", name: "Water pump", unitPriceCents: 51_500, updatedAt: "2026-01-01" }],
  globalRate: 8200,
  fetchedAt: "2026-01-01",
};

const ORDER_ID = "order-under-test";
const USER_ID = "user-a";

afterEach(cleanup);

beforeEach(async () => {
  await clearAll();
  vi.resetAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  vi.mocked(api.catalog).mockResolvedValue({ ok: true, data: CATALOG });
  vi.mocked(api.getOrder).mockResolvedValue({
    ok: false,
    status: 404,
    error: { code: "NOT_FOUND", message: "not found" },
  });
});

describe("useOrder — review M-4 (clientUnitPriceCents + priceChanges)", () => {
  it("sends clientUnitPriceCents (the cached catalog price) for every line on save", async () => {
    vi.mocked(api.saveOrder).mockResolvedValue({
      ok: true,
      data: {
        order: {
          id: ORDER_ID,
          number: 1,
          status: "saved",
          createdBy: { id: USER_ID, name: "Amina" },
          dealer: CATALOG.dealers[0],
          rate: 8200,
          lines: [],
          totals: { usdCents: 51_500, sdg: 422_300_00 },
          canSave: true,
          blockingLineIds: [],
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
          savedAt: "2026-01-01",
        } as never,
        replayed: false,
        priceChanges: [],
      },
    });

    const { result } = renderHook(() => useOrder(ORDER_ID, USER_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setDealerId("dealer-1");
      result.current.addLine("prod-1");
    });

    await waitFor(() => expect(result.current.lines).toHaveLength(1));

    await act(async () => {
      await result.current.save();
    });

    expect(api.saveOrder).toHaveBeenCalledTimes(1);
    const [, sentInput] = vi.mocked(api.saveOrder).mock.calls[0] as [string, OrderInput];
    expect(sentInput.lines[0]).toMatchObject({ productId: "prod-1", clientUnitPriceCents: 51_500 });
  });
});
