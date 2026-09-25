import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueue, listOutboxFifo, outboxCount } from "./outbox";
import { clearAll } from "./db";
import type { OrderInput } from "@/contracts/api";

const input = (rate: number): OrderInput => ({ dealerId: "dealer-1", rate, lines: [] });

beforeEach(async () => {
  await clearAll();
});

describe("outbox", () => {
  it("keeps the latest payload for the same order (coalescing)", async () => {
    await enqueue("order-1", "draft", input(8200));
    await enqueue("order-1", "draft", input(9000));
    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.rate).toBe(9000);
  });

  it("never downgrades a queued save back to draft", async () => {
    await enqueue("order-2", "save", input(8200));
    await enqueue("order-2", "draft", input(8300));
    const entries = await listOutboxFifo();
    expect(entries).toHaveLength(1);
    expect(entries[0].intent).toBe("save");
    expect(entries[0].payload.rate).toBe(8300);
  });

  it("upgrades a queued draft to save", async () => {
    await enqueue("order-3", "draft", input(8200));
    await enqueue("order-3", "save", input(8200));
    const entries = await listOutboxFifo();
    expect(entries[0].intent).toBe("save");
  });

  it("counts distinct orders in the outbox", async () => {
    await enqueue("order-4", "draft", input(8200));
    await enqueue("order-5", "draft", input(8200));
    expect(await outboxCount()).toBe(2);
  });
});
