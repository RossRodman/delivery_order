import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";
import { adviserToken, ownerToken } from "../helpers/http";
import { ac1Lines, decide, orderInput, putOrder, requestApproval, saveOrder, termsOf } from "../helpers/orders";

beforeEach(resetAndSeed);
afterAll(closeTestDb);

async function approvedOrder() {
  const adviser = await adviserToken();
  const owner = await ownerToken();
  const id = randomUUID();
  const lines = ac1Lines();
  const res = await requestApproval(adviser, id, orderInput([lines.line1, lines.line2, lines.line3]));
  const decided = await decide(owner, id, lines.line3.id, "approve", termsOf(res.body.order.lines[2]));
  expect(decided.body.order.lines[2].state).toBe("approved");
  return { adviser, id, lines };
}

describe("AC6 — approval voiding", () => {
  it("discount 15,000 → 15,100 after approval → blocked, approval none, save 422", async () => {
    const { adviser, id, lines } = await approvedOrder();
    const changed = orderInput([lines.line1, lines.line2, { ...lines.line3, discountCents: 15_100 }]);
    const put = await putOrder(adviser, id, changed);
    expect(put.status).toBe(200);
    expect(put.body.lines[2]).toMatchObject({ state: "blocked", approval: { status: "none", decidedBy: null } });
    const save = await saveOrder(adviser, id, changed);
    expect(save.status).toBe(422);
    expect(save.body.error).toMatchObject({ code: "UNAPPROVED_BLOCKED_LINES", details: { lineIds: [lines.line3.id] } });
  });

  it("qty change after approval also voids it", async () => {
    const { adviser, id, lines } = await approvedOrder();
    const put = await putOrder(adviser, id, orderInput([lines.line1, lines.line2, { ...lines.line3, qty: 2, discountCents: 30_000 }]));
    expect(put.body.lines[2]).toMatchObject({ state: "blocked", approval: { status: "none" } });
  });

  it("PUT with unchanged terms keeps approval.status='approved' (M-1)", async () => {
    const { adviser, id, lines } = await approvedOrder();
    const put = await putOrder(adviser, id, orderInput([lines.line1, lines.line2, lines.line3], { rate: 8300 }));
    expect(put.body.lines[2]).toMatchObject({ state: "approved", approval: { status: "approved" } });
    const save = await saveOrder(adviser, id, orderInput([lines.line1, lines.line2, lines.line3], { rate: 8300 }));
    expect(save.status).toBe(200);
  });

  it("an owner price change voids the approval on the next PUT (plan §11.12)", async () => {
    const { adviser, id, lines } = await approvedOrder();
    await testDb().sql`UPDATE products SET unit_price_cents = 206000 WHERE id = ${P.battery.id}`;
    const put = await putOrder(adviser, id, orderInput([lines.line1, lines.line2, { ...lines.line3, clientUnitPriceCents: 207000 }]));
    expect(put.body.lines[2]).toMatchObject({ unitPriceCents: 206000, state: "blocked", approval: { status: "none" } });
    expect(put.body.priceChanges).toHaveLength(1);
  });

  it("raw SQL terms update on an approved line clears the approval (trigger 4)", async () => {
    const { id, lines } = await approvedOrder();
    const { sql } = testDb();
    await sql`UPDATE order_lines SET discount_cents = 15100 WHERE order_id = ${id} AND id = ${lines.line3.id}`;
    const [row] = await sql`SELECT approval_status, approved_discount_cents FROM order_lines WHERE id = ${lines.line3.id}`;
    expect(row).toMatchObject({ approval_status: "none", approved_discount_cents: null });
  });
});
