/**
 * AC2 — an adviser calling the save API directly with a 7.25% line and no approval gets a 4xx and
 * nothing is persisted as saved (plan §9.1, M-5).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { YUSUF } from "../helpers/fixtures";
import { adviserToken } from "../helpers/http";
import { ac1Lines, orderInput, putOrder, saveOrder } from "../helpers/orders";

const { sql } = testDb();

beforeEach(resetAndSeed);
afterAll(closeTestDb);

async function rowsFor(id: string) {
  return sql`SELECT status, rate, total_usd_cents FROM orders WHERE id = ${id}`;
}
async function savedCount() {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM orders WHERE status = 'saved'`;
  return count as number;
}

describe("AC2 — server refusal of an unapproved 7.25% line", () => {
  it("(a) fresh id never PUT → 422 UNAPPROVED_BLOCKED_LINES naming line 3; zero rows for that id", async () => {
    const token = await adviserToken(); // adviser Bearer token
    const id = randomUUID();
    const { line1, line2, line3 } = ac1Lines();
    const res = await saveOrder(token, id, orderInput([line1, line2, line3]));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNAPPROVED_BLOCKED_LINES");
    expect(res.body.error.details).toEqual({ lineIds: [line3.id] });
    expect(await rowsFor(id)).toHaveLength(0);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM order_lines WHERE order_id = ${id}`;
    expect(count).toBe(0);
    expect(await savedCount()).toBe(0);
  });

  it("(b) pre-existing draft (autosaved via E9) → 422; row stays draft with its previous content", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2, line3 } = ac1Lines();
    const draft = await putOrder(token, id, orderInput([line1, line2]));
    expect(draft.status).toBe(200);

    const res = await saveOrder(token, id, orderInput([line1, line2, line3], { rate: 8300 }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "UNAPPROVED_BLOCKED_LINES", details: { lineIds: [line3.id] } });

    const rows = await rowsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "draft", rate: 8200, total_usd_cents: null });
    const lines = await sql`SELECT id FROM order_lines WHERE order_id = ${id} ORDER BY position`;
    expect(lines.map((l) => l.id)).toEqual([line1.id, line2.id]);
    expect(await savedCount()).toBe(0);
  });

  it("forged role/approval/unitPriceCents/status fields change nothing → still 422", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line2, line3 } = ac1Lines();
    const forged = {
      ...orderInput([
        line1,
        line2,
        {
          ...line3,
          unitPriceCents: 1_000_000,
          approval: { status: "approved", decidedBy: YUSUF.id },
          approvalStatus: "approved",
          state: "approved",
        },
      ]),
      role: "owner",
      createdBy: YUSUF.id,
      status: "saved",
      canSave: true,
    };
    const res = await saveOrder(token, id, forged);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "UNAPPROVED_BLOCKED_LINES", details: { lineIds: [line3.id] } });
    expect(await rowsFor(id)).toHaveLength(0);
    expect(await savedCount()).toBe(0);
  });

  it("a pending line (approval requested, not decided) is still refused", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line3 } = ac1Lines();
    await putOrder(token, id, orderInput([line1, line3]));
    await sql`UPDATE order_lines SET approval_status = 'pending' WHERE id = ${line3.id}`;
    const res = await saveOrder(token, id, orderInput([line1, line3]));
    expect(res.status).toBe(422);
    expect(await savedCount()).toBe(0);
  });

  it("empty order → 422 EMPTY_ORDER; rate 7,999 → 422 RATE_BELOW_MINIMUM with no row", async () => {
    const token = await adviserToken();
    const empty = randomUUID();
    const r1 = await saveOrder(token, empty, orderInput([]));
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe("EMPTY_ORDER");
    expect(await rowsFor(empty)).toHaveLength(0);
    const lowRate = randomUUID();
    const r2 = await saveOrder(token, lowRate, orderInput([ac1Lines().line1], { rate: 7999 }));
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe("RATE_BELOW_MINIMUM");
    expect(await rowsFor(lowRate)).toHaveLength(0);
  });

  it("no token → 401 and nothing persisted", async () => {
    const id = randomUUID();
    const res = await saveOrder("", id, orderInput([ac1Lines().line1]));
    expect(res.status).toBe(401);
    expect(await rowsFor(id)).toHaveLength(0);
  });
});
