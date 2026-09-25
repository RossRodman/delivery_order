import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAll, getLocalOrder, setCachedMe } from "./db";
import { enqueue, listOutboxFifo } from "./outbox";
import type { OrderInput, UserView } from "@/contracts/api";

vi.mock("@/client/api", () => ({
  api: {
    putOrder: vi.fn(),
    saveOrder: vi.fn(),
  },
}));

const { api } = await import("@/client/api");
const { runSync, getNeedsSignIn } = await import("./sync");

const input: OrderInput = { dealerId: "dealer-1", rate: 8200, lines: [] };
const USER_A: UserView = { id: "user-a", name: "Amina", role: "adviser" };
const USER_B: UserView = { id: "user-b", name: "Yusuf", role: "owner" };

beforeEach(async () => {
  await clearAll();
  vi.resetAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  await setCachedMe(USER_A);
});

describe("sync engine", () => {
  it("marks an order synced and removes it from the outbox on 200", async () => {
    await enqueue("o-200", "draft", input, USER_A.id);
    vi.mocked(api.putOrder).mockResolvedValue({
      ok: true,
      data: { id: "o-200" } as never,
    });

    await runSync();

    expect(await listOutboxFifo()).toHaveLength(0);
    const local = await getLocalOrder("o-200");
    expect(local?.syncState).toBe("synced");
  });

  it("treats ORDER_ALREADY_SAVED as synced", async () => {
    await enqueue("o-409", "save", input, USER_A.id);
    vi.mocked(api.saveOrder).mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: "ORDER_ALREADY_SAVED", message: "already saved", details: {} },
    });

    await runSync();

    expect(await listOutboxFifo()).toHaveLength(0);
    const local = await getLocalOrder("o-409");
    expect(local?.syncState).toBe("synced");
  });

  it("marks an order rejected on a 422 and keeps it out of the outbox", async () => {
    await enqueue("o-422", "save", input, USER_A.id);
    vi.mocked(api.saveOrder).mockResolvedValue({
      ok: false,
      status: 422,
      error: { code: "UNAPPROVED_BLOCKED_LINES", message: "needs approval", details: { lineIds: ["l1"] } },
    });

    await runSync();

    expect(await listOutboxFifo()).toHaveLength(0);
    const local = await getLocalOrder("o-422");
    expect(local?.syncState).toBe("rejected");
    expect(local?.lastError?.code).toBe("UNAPPROVED_BLOCKED_LINES");
  });

  it("keeps the queue, stops the run and flags needsSignIn on 401", async () => {
    await enqueue("o-401", "draft", input, USER_A.id);
    vi.mocked(api.putOrder).mockResolvedValue({
      ok: false,
      status: 401,
      error: { code: "UNAUTHENTICATED", message: "sign in" },
    });

    await runSync();

    expect(await listOutboxFifo()).toHaveLength(1);
    expect(getNeedsSignIn()).toBe(true);
  });

  it("keeps the queue and stops the run on a network failure", async () => {
    await enqueue("o-net", "draft", input, USER_A.id);
    vi.mocked(api.putOrder).mockResolvedValue({
      ok: false,
      status: 0,
      error: { code: "NETWORK", message: "offline" },
    });

    await runSync();

    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].attempts).toBe(1);
  });

  it("does nothing while the browser reports offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await enqueue("o-offline", "draft", input, USER_A.id);

    await runSync();

    expect(api.putOrder).not.toHaveBeenCalled();
    expect(await listOutboxFifo()).toHaveLength(1);
  });

  it("review M-1: never replays another user's queued entry", async () => {
    // Queued while signed in as B, but A is the one currently signed in on this device.
    await enqueue("o-cross-user", "save", input, USER_B.id);
    await setCachedMe(USER_A);

    await runSync();

    expect(api.putOrder).not.toHaveBeenCalled();
    expect(api.saveOrder).not.toHaveBeenCalled();
    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].orderId).toBe("o-cross-user");
  });

  it("review M-1: replays a matching user's entry once they sign back in", async () => {
    await enqueue("o-later", "save", input, USER_B.id);
    await setCachedMe(USER_B);
    vi.mocked(api.saveOrder).mockResolvedValue({ ok: true, data: { order: { id: "o-later" }, replayed: false, priceChanges: [] } as never });

    await runSync();

    expect(api.saveOrder).toHaveBeenCalledWith("o-later", input);
    expect(await listOutboxFifo()).toHaveLength(0);
  });

  it("does nothing when no user is cached at all", async () => {
    await clearAll();
    await enqueue("o-nouser", "draft", input, USER_A.id);

    await runSync();

    expect(api.putOrder).not.toHaveBeenCalled();
    expect(await listOutboxFifo()).toHaveLength(1);
  });
});
