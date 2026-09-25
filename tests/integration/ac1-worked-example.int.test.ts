import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { adviserToken } from "../helpers/http";
import { ac1Lines, getOrder, orderInput, saveOrder } from "../helpers/orders";

beforeEach(resetAndSeed);
afterAll(closeTestDb);

describe("AC1 — worked example at rate 8,200", () => {
  it("lines 1–2 save with $3,570 = 29,274,000 SDG", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2 } = ac1Lines();
    const res = await saveOrder(token, id, orderInput([line1, line2]));
    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(false);
    expect(res.body.order).toMatchObject({ status: "saved", rate: 8200, totals: { usdCents: 357000, sdg: 29274000 } });
    expect(res.body.order.savedAt).not.toBeNull();
    expect(res.body.order.lines.map((l) => [l.discountBasisPoints, l.state, l.lineTotalCents])).toEqual([
      [194, "sand", 202000],
      [432, "red", 155000],
    ]);
    const [row] = await testDb().sql`SELECT status, total_usd_cents, total_sdg FROM orders WHERE id = ${id}`;
    expect(row.status).toBe("saved");
    expect(Number(row.total_usd_cents)).toBe(357000);
    expect(Number(row.total_sdg)).toBe(29274000);
    const read = await getOrder(token, id);
    expect(read.body.totals).toEqual({ usdCents: 357000, sdg: 29274000 });
    expect(read.body.canSave).toBe(false);
  });
});
