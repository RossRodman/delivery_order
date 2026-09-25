import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { AMINA, P, YUSUF } from "../helpers/fixtures";
import { adviserToken, ownerToken, tokenFor } from "../helpers/http";
import { ac1Lines, getOrder, listOrders, orderInput, putOrder } from "../helpers/orders";

const { sql } = testDb();

beforeEach(resetAndSeed);
afterAll(closeTestDb);

async function orderCount(id: string) {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders WHERE id = ${id}`;
  return count as number;
}

describe("E9 PUT /api/orders/:id — drafts", () => {
  it("creates a draft with DB prices and computed totals (200)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2, line3 } = ac1Lines();
    const res = await putOrder(token, id, orderInput([line1, line2, line3]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      status: "draft",
      rate: 8200,
      createdBy: { id: AMINA.id, name: "Amina" },
      dealer: { name: "Al-Noor Trading", city: "Khartoum" },
      totals: { usdCents: 549000, sdg: 45018000 },
      canSave: false,
      blockingLineIds: [line3.id],
      savedAt: null,
      priceChanges: [],
    });
    expect(res.body.number).toBeGreaterThan(0);
    expect(res.body.lines.map((l) => [l.position, l.unitPriceCents, l.discountBasisPoints, l.classification, l.state, l.lineTotalCents])).toEqual([
      [0, 51500, 194, "sand", "sand", 202000],
      [1, 81000, 432, "red", "red", 155000],
      [2, 207000, 725, "blocked", "blocked", 192000],
    ]);
    expect(res.body.lines[2]).toMatchObject({
      product: { id: P.battery.id, sku: "BATT-03", name: "Battery" },
      approval: { status: "none", decidedBy: null, decidedAt: null },
    });
  });

  it("ignores client unitPriceCents; reports clientUnitPriceCents differences in priceChanges (R1)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2 } = ac1Lines();
    const res = await putOrder(token, id, {
      ...orderInput([
        { ...line1, unitPriceCents: 1, clientUnitPriceCents: 50000 },
        { ...line2, clientUnitPriceCents: 81000 },
      ]),
      status: "saved",
      createdBy: YUSUF.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.lines[0].unitPriceCents).toBe(51500);
    expect(res.body.status).toBe("draft");
    expect(res.body.createdBy.id).toBe(AMINA.id);
    expect(res.body.priceChanges).toEqual([
      { lineId: line1.id, productId: P.pump.id, clientUnitPriceCents: 50000, serverUnitPriceCents: 51500 },
    ]);
  });

  it("updates: removed lines are deleted, positions follow array order", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2, line3 } = ac1Lines();
    await putOrder(token, id, orderInput([line1, line2, line3]));
    const res = await putOrder(token, id, orderInput([line2, line1], { rate: 8300 }));
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l) => l.id)).toEqual([line2.id, line1.id]);
    expect(res.body.rate).toBe(8300);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM order_lines WHERE order_id = ${id}`;
    expect(count).toBe(2);
    const empty = await putOrder(token, id, orderInput([]));
    expect(empty.body.lines).toEqual([]);
    expect(empty.body.canSave).toBe(false);
  });

  it("rate 7,999 → 422 RATE_BELOW_MINIMUM and no row created (AC3)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const res = await putOrder(token, id, orderInput([ac1Lines().line1], { rate: 7999 }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "RATE_BELOW_MINIMUM", details: { min: 8000 } });
    expect(await orderCount(id)).toBe(0);
  });

  it("rate 7,999 on an existing draft → 422, draft keeps its rate", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    await putOrder(token, id, orderInput([ac1Lines().line1]));
    const res = await putOrder(token, id, orderInput([ac1Lines().line1], { rate: 7999 }));
    expect(res.status).toBe(422);
    const [row] = await sql`SELECT rate FROM orders WHERE id = ${id}`;
    expect(row.rate).toBe(8200);
  });

  it("unknown dealer / product → 422 (no row)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const dealer = await putOrder(token, id, orderInput([], { dealerId: randomUUID() }));
    expect(dealer.status).toBe(422);
    expect(dealer.body.error.code).toBe("UNKNOWN_DEALER");
    const badLine = { id: randomUUID(), productId: randomUUID(), qty: 1, discountCents: 0 };
    const product = await putOrder(token, id, orderInput([ac1Lines().line1, badLine]));
    expect(product.status).toBe(422);
    expect(product.body.error).toMatchObject({ code: "UNKNOWN_PRODUCT", details: { lineIds: [badLine.id] } });
    expect(await orderCount(id)).toBe(0);
  });

  it("discount > qty × DB price → 422 DISCOUNT_EXCEEDS_LINE_VALUE listing every offending line", async () => {
    const token = await adviserToken();
    const { line1, line2 } = ac1Lines();
    const a = { ...line1, discountCents: 206001 };
    const b = { ...line2, discountCents: 999999, clientUnitPriceCents: 10_000_000 };
    const res = await putOrder(token, randomUUID(), orderInput([a, b]));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "DISCOUNT_EXCEEDS_LINE_VALUE", details: { lineIds: [a.id, b.id] } });
  });

  it("validation failures → 400 (qty 0, duplicate ids, bad uuid in path → 404)", async () => {
    const token = await adviserToken();
    const { line1 } = ac1Lines();
    expect((await putOrder(token, randomUUID(), orderInput([{ ...line1, qty: 0 }]))).status).toBe(400);
    expect((await putOrder(token, randomUUID(), orderInput([line1, line1]))).status).toBe(400);
    expect((await putOrder(token, "not-a-uuid", orderInput([line1]))).status).toBe(404);
  });

  it("changing an approved line's terms resets approval; unchanged terms keep it (AC6, M-1)", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line3 } = ac1Lines();
    await putOrder(token, id, orderInput([line1, line3]));
    await sql`UPDATE order_lines SET approval_status = 'approved', approved_product_id = product_id, approved_qty = qty,
                approved_unit_price_cents = unit_price_cents, approved_discount_cents = discount_cents,
                decided_by = ${YUSUF.id}, decided_at = now() WHERE id = ${line3.id}`;

    const same = await putOrder(token, id, orderInput([line3, line1], { rate: 8500 }));
    expect(same.body.lines.find((l) => l.id === line3.id)).toMatchObject({
      state: "approved",
      approval: { status: "approved", decidedBy: { id: YUSUF.id, name: "Yusuf" } },
    });
    expect(same.body.canSave).toBe(true);

    const changed = await putOrder(token, id, orderInput([line1, { ...line3, discountCents: 15100 }]));
    expect(changed.body.lines[1]).toMatchObject({ state: "blocked", approval: { status: "none", decidedBy: null } });
    expect(changed.body.canSave).toBe(false);
  });

  it("PUT on a saved order → 409 ORDER_IMMUTABLE; on a pending order → 409 ORDER_NOT_EDITABLE", async () => {
    const token = await adviserToken();
    const savedId = randomUUID();
    await putOrder(token, savedId, orderInput([ac1Lines().line1]));
    await sql`UPDATE orders SET status = 'saved', total_usd_cents = 202000, total_sdg = 16564000, saved_at = now() WHERE id = ${savedId}`;
    const saved = await putOrder(token, savedId, orderInput([ac1Lines().line1]));
    expect(saved.status).toBe(409);
    expect(saved.body.error.code).toBe("ORDER_IMMUTABLE");

    const pendingId = randomUUID();
    await putOrder(token, pendingId, orderInput([ac1Lines().line3]));
    await sql`UPDATE orders SET status = 'pending_approval' WHERE id = ${pendingId}`;
    const pending = await putOrder(token, pendingId, orderInput([ac1Lines().line1]));
    expect(pending.status).toBe(409);
    expect(pending.body.error.code).toBe("ORDER_NOT_EDITABLE");
  });
});

describe("ownership", () => {
  it("adviser B cannot GET or PUT adviser A's order (404); the owner can GET but not PUT", async () => {
    const adviserB = randomUUID();
    await sql`INSERT INTO users (id, name, role) VALUES (${adviserB}, 'Bashir', 'adviser')`;
    const tokenA = await adviserToken();
    const tokenB = await tokenFor(adviserB);
    const id = randomUUID();
    const { line1 } = ac1Lines();
    await putOrder(tokenA, id, orderInput([line1]));

    expect((await getOrder(tokenB, id)).status).toBe(404);
    const put = await putOrder(tokenB, id, orderInput([{ ...line1, discountCents: 0 }]));
    expect(put.status).toBe(404);
    const [line] = await sql`SELECT discount_cents FROM order_lines WHERE id = ${line1.id}`;
    expect(Number(line.discount_cents)).toBe(4000);

    const owner = await ownerToken();
    expect((await getOrder(owner, id)).status).toBe(200);
    expect((await putOrder(owner, id, orderInput([line1]))).status).toBe(404);
    expect((await getOrder(tokenA, randomUUID())).status).toBe(404);
  });
});

describe("E7 list", () => {
  it("adviser sees own only, owner sees all; status filter and pendingApproval count", async () => {
    const adviserB = randomUUID();
    await sql`INSERT INTO users (id, name, role) VALUES (${adviserB}, 'Bashir', 'adviser')`;
    const tokenA = await adviserToken();
    const tokenB = await tokenFor(adviserB);
    const owner = await ownerToken();

    const a1 = randomUUID();
    const a2 = randomUUID();
    const b1 = randomUUID();
    const { line1, line2, line3 } = ac1Lines();
    await putOrder(tokenA, a1, orderInput([line1, line2]));
    await putOrder(tokenA, a2, orderInput([line3]));
    await putOrder(tokenB, b1, orderInput([ac1Lines().line3]));
    await sql`UPDATE order_lines SET approval_status = 'rejected', decided_by = ${YUSUF.id}, decided_at = now() WHERE id = ${line3.id}`;
    await sql`UPDATE orders SET status = 'pending_approval' WHERE id IN (${a2}, ${b1})`;

    const listA = await listOrders(tokenA);
    expect(listA.status).toBe(200);
    expect(listA.body.orders.map((o) => o.id).sort()).toEqual([a1, a2].sort());
    expect(listA.body.counts.pendingApproval).toBe(1);
    const summary = listA.body.orders.find((o) => o.id === a1)!;
    expect(summary).toMatchObject({
      status: "draft",
      dealer: { name: "Al-Noor Trading" },
      createdBy: { id: AMINA.id, name: "Amina" },
      rate: 8200,
      totalUsdCents: 357000,
      lineCount: 2,
      blockedLineCount: 0,
      hasRejectedLines: false,
      savedAt: null,
    });
    expect(listA.body.orders.find((o) => o.id === a2)).toMatchObject({ blockedLineCount: 1, hasRejectedLines: true });

    const all = await listOrders(owner);
    expect(all.body.orders).toHaveLength(3);
    expect(all.body.counts.pendingApproval).toBe(2);
    const pending = await listOrders(owner, "?status=pending_approval");
    expect(pending.body.orders.map((o) => o.id).sort()).toEqual([a2, b1].sort());
    expect((await listOrders(owner, "?status=bogus")).status).toBe(400);
    expect((await listOrders(owner, "?limit=1")).body.orders).toHaveLength(1);
  });
});
