import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueue, listOutboxFifo, outboxCount } from "./outbox";
import { clearAll } from "./db";
import type { OrderInput } from "@/contracts/api";

const USER_A = "user-a";
const USER_B = "user-b";

const input = (rate: number): OrderInput => ({ dealerId: "dealer-1", rate, lines: [] });

beforeEach(async () => {
  await clearAll();
});

describe("outbox", () => {
  it("keeps the latest payload for the same order (coalescing)", async () => {
    await enqueue("order-1", "draft", input(8200), USER_A);
    await enqueue("order-1", "draft", input(9000), USER_A);
    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.rate).toBe(9000);
  });

  it("never downgrades a queued save back to draft", async () => {
    await enqueue("order-2", "save", input(8200), USER_A);
    await enqueue("order-2", "draft", input(8300), USER_A);
    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].intent).toBe("save");
    expect(entries[0].payload.rate).toBe(8300);
  });

  it("upgrades a queued draft to save", async () => {
    await enqueue("order-3", "draft", input(8200), USER_A);
    await enqueue("order-3", "save", input(8200), USER_A);
    const entries = await listOutboxFifo();
    expect(entries[0].intent).toBe("save");
  });

  it("counts distinct orders in the outbox", async () => {
    await enqueue("order-4", "draft", input(8200), USER_A);
    await enqueue("order-5", "draft", input(8200), USER_A);
    expect(await outboxCount()).toBe(2);
  });

  it("counts only the given user's entries when scoped (review M-1)", async () => {
    await enqueue("order-6", "draft", input(8200), USER_A);
    await enqueue("order-7", "draft", input(8200), USER_B);
    expect(await outboxCount(USER_A)).toBe(1);
    expect(await outboxCount(USER_B)).toBe(1);
    expect(await outboxCount()).toBe(2);
  });

  it("keeps an entry's original userId even if re-enqueued (defence in depth for M-1)", async () => {
    await enqueue("order-8", "draft", input(8200), USER_A);
    await enqueue("order-8", "draft", input(9000), USER_B);
    const entries = await listOutboxFifo();
    expect(entries[0].userId).toBe(USER_A);
  });
});
