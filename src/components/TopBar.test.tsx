// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAll, getCachedMe, setCachedMe } from "@/client/offline/db";
import { enqueue, listOutboxFifo } from "@/client/offline/outbox";
import type { OrderInput, UserView } from "@/contracts/api";

vi.mock("@/client/api", () => ({
  api: {
    logout: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  },
}));

const { TopBar } = await import("./TopBar");

const AMINA: UserView = { id: "user-a", name: "Amina", role: "adviser" };
const input: OrderInput = { dealerId: "dealer-1", rate: 8200, lines: [] };

afterEach(cleanup);

beforeEach(async () => {
  await clearAll();
  // Offline, so useOnline's app-start sync trigger doesn't try to call the (unmocked) putOrder.
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.spyOn(window, "location", "set").mockImplementation(() => {});
});

describe("TopBar sign-out — review N-1", () => {
  it("keeps this user's pending outbox entries and cached identity is the only thing cleared", async () => {
    await enqueue("order-pending", "save", input, AMINA.id);
    await setCachedMe(AMINA);

    render(<TopBar user={AMINA} />);

    const signOut = await screen.findByRole("button", { name: "Sign out" });
    fireEvent.click(signOut);

    // Let the async handler (confirm -> logout -> clearCachedMe -> clearServiceWorkerCaches) run.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The order the confirmation dialog promised would survive is still queued.
    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].orderId).toBe("order-pending");

    // Only the cached identity was forgotten.
    expect(await getCachedMe()).toBeUndefined();
  });

  it("does not sign out when the confirmation is declined", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    await enqueue("order-pending-2", "save", input, AMINA.id);
    await setCachedMe(AMINA);

    render(<TopBar user={AMINA} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await new Promise((r) => setTimeout(r, 0));

    const { api } = await import("@/client/api");
    expect(api.logout).not.toHaveBeenCalled();
    expect(await getCachedMe()).toEqual(AMINA);
  });
});
