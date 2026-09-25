import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";
import { adviserToken, tokenFor } from "../helpers/http";
import { ac1Lines, orderInput, putOrder, saveOrder } from "../helpers/orders";

const { sql } = testDb();

beforeEach(resetAndSeed);
afterAll(closeTestDb);

describe("save idempotency (AC7 server side, plan §8.4)", () => {
  it("identical replay → 200 replayed:true, single row", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2 } = ac1Lines();
    const body = orderInput([line1, line2]);
    const first = await saveOrder(token, id, body);
    expect(first.status).toBe(200);
    expect(first.body.replayed).toBe(false);
    // Same content with keys in another order and extra informational fields.
    const replayBody = {
      lines: body.lines.map((l) => ({ discountCents: l.discountCents, qty: l.qty, productId: l.productId, id: l.id.toUpperCase() })),
      rate: 8200,
      dealerId: body.dealerId,
    };
    const second = await saveOrder(token, id, replayBody);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.order).toEqual(first.body.order);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders WHERE id = ${id}`;
    expect(count).toBe(1);
  });

  it("replay with different content → 409 ORDER_ALREADY_SAVED with the saved order", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2 } = ac1Lines();
    await saveOrder(token, id, orderInput([line1, line2]));
    const res = await saveOrder(token, id, orderInput([line1, { ...line2, qty: 3 }]));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_ALREADY_SAVED");
    const saved = (res.body.error.details as { order: { id: string; totals: unknown } }).order;
    expect(saved).toMatchObject({ id, totals: { usdCents: 357000, sdg: 29274000 } });
  });

  it("another user's order id → 404 (never replayed to them)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const body = orderInput([ac1Lines().line1]);
    await saveOrder(token, id, body);
    const other = randomUUID();
    await sql`INSERT INTO users (id, name, role) VALUES (${other}, 'Bashir', 'adviser')`;
    const res = await saveOrder(await tokenFor(other), id, body);
    expect(res.status).toBe(404);
  });

  it("price changed since the client cached it → saved at the DB price with priceChanges", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2 } = ac1Lines();
    await sql`UPDATE products SET unit_price_cents = 52000 WHERE id = ${P.pump.id}`;
    const res = await saveOrder(token, id, orderInput([
      { ...line1, clientUnitPriceCents: 51500 },
      { ...line2, clientUnitPriceCents: 81000 },
    ]));
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("saved");
    expect(res.body.order.lines[0].unitPriceCents).toBe(52000);
    expect(res.body.order.totals.usdCents).toBe(4 * 52000 - 4000 + 155000);
    expect(res.body.priceChanges).toEqual([
      { lineId: line1.id, productId: P.pump.id, clientUnitPriceCents: 51500, serverUnitPriceCents: 52000 },
    ]);
  });

  it("price change that makes a line blocked → 422 and nothing saved", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    // 4 × $515 with a $100 discount = 4.85% (red). Price drops to $450 → 5.56% → blocked.
    const line = { ...ac1Lines().line1, discountCents: 10_000, clientUnitPriceCents: 51500 };
    await sql`UPDATE products SET unit_price_cents = 45000 WHERE id = ${P.pump.id}`;
    const res = await saveOrder(token, id, orderInput([line]));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "UNAPPROVED_BLOCKED_LINES", details: { lineIds: [line.id] } });
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders WHERE id = ${id}`;
    expect(count).toBe(0);
  });

  it("a queued offline draft then save both succeed (draft PUT, then save)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const body = orderInput([ac1Lines().line1]);
    expect((await putOrder(token, id, body)).status).toBe(200);
    const res = await saveOrder(token, id, body);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("saved");
  });
});
