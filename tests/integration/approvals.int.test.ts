import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { YUSUF } from "../helpers/fixtures";
import { adviserToken, ownerToken } from "../helpers/http";
import {
  ac1Lines,
  decide,
  orderInput,
  putOrder,
  requestApproval,
  saveOrder,
  termsOf,
  withdrawApproval,
} from "../helpers/orders";

beforeEach(resetAndSeed);
afterAll(closeTestDb);

async function pendingOrder() {
  const adviser = await adviserToken();
  const owner = await ownerToken();
  const id = randomUUID();
  const lines = ac1Lines();
  const body = orderInput([lines.line1, lines.line2, lines.line3]);
  const res = await requestApproval(adviser, id, body);
  return { adviser, owner, id, lines, body, res };
}

describe("E11 request-approval", () => {
  it("7.25% line → order pending_approval, only the blocked line pending", async () => {
    const { res, lines } = await pendingOrder();
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("pending_approval");
    expect(res.body.order.canSave).toBe(false);
    expect(res.body.order.lines.map((l) => l.approval.status)).toEqual(["none", "none", "pending"]);
    expect(res.body.order.blockingLineIds).toEqual([lines.line3.id]);
    expect(res.body.priceChanges).toEqual([]);
  });

  it("no blocked lines → 422 NO_LINES_NEED_APPROVAL; empty → 422 EMPTY_ORDER", async () => {
    const adviser = await adviserToken();
    const { line1, line2 } = ac1Lines();
    const none = await requestApproval(adviser, randomUUID(), orderInput([line1, line2]));
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe("NO_LINES_NEED_APPROVAL");
    const empty = await requestApproval(adviser, randomUUID(), orderInput([]));
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe("EMPTY_ORDER");
  });

  it("pending orders are read-only: PUT/save/request → 409 ORDER_NOT_EDITABLE", async () => {
    const { adviser, id, body } = await pendingOrder();
    expect((await putOrder(adviser, id, body)).body.error.code).toBe("ORDER_NOT_EDITABLE");
    expect((await saveOrder(adviser, id, body)).body.error.code).toBe("ORDER_NOT_EDITABLE");
    expect((await requestApproval(adviser, id, body)).body.error.code).toBe("ORDER_NOT_EDITABLE");
  });
});

describe("E13 decision", () => {
  it("approve with matching expectedTerms → approved; order returns to draft; saveable", async () => {
    const { owner, adviser, id, lines, res, body } = await pendingOrder();
    const line3 = res.body.order.lines[2];
    const decided = await decide(owner, id, lines.line3.id, "approve", termsOf(line3));
    expect(decided.status).toBe(200);
    expect(decided.body.order.status).toBe("draft");
    expect(decided.body.order.lines[2]).toMatchObject({
      state: "approved",
      approval: { status: "approved", decidedBy: { id: YUSUF.id, name: "Yusuf" } },
    });
    expect(decided.body.order.lines[2].approval.decidedAt).not.toBeNull();
    expect(decided.body.order.canSave).toBe(true);
    const saved = await saveOrder(adviser, id, body);
    expect(saved.status).toBe(200);
    expect(saved.body.order.totals).toEqual({ usdCents: 549000, sdg: 45018000 });
  });

  it("order stays pending while another line is still pending", async () => {
    const adviser = await adviserToken();
    const owner = await ownerToken();
    const id = randomUUID();
    const { line3 } = ac1Lines();
    const other = { id: randomUUID(), productId: line3.productId, qty: 2, discountCents: 30_000 };
    const res = await requestApproval(adviser, id, orderInput([line3, other]));
    expect(res.body.order.lines.map((l) => l.approval.status)).toEqual(["pending", "pending"]);
    const first = await decide(owner, id, line3.id, "approve", termsOf(res.body.order.lines[0]));
    expect(first.body.order.status).toBe("pending_approval");
    const second = await decide(owner, id, other.id, "reject", termsOf(res.body.order.lines[1]));
    expect(second.body.order.status).toBe("draft");
  });

  it("stale expectedTerms → 409 LINE_TERMS_CHANGED with the current line", async () => {
    const { owner, id, lines, res } = await pendingOrder();
    const stale = { ...termsOf(res.body.order.lines[2]), discountCents: 14_000 };
    const out = await decide(owner, id, lines.line3.id, "approve", stale);
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe("LINE_TERMS_CHANGED");
    expect((out.body.error.details as { line: { id: string; discountCents: number } }).line).toMatchObject({
      id: lines.line3.id,
      discountCents: 15_000,
    });
    const [row] = await testDb().sql`SELECT approval_status FROM order_lines WHERE id = ${lines.line3.id}`;
    expect(row.approval_status).toBe("pending");
  });

  it("decision on a non-pending line → 409 LINE_NOT_PENDING; unknown line → 404", async () => {
    const { owner, id, lines, res } = await pendingOrder();
    const notPending = await decide(owner, id, lines.line1.id, "approve", termsOf(res.body.order.lines[0]));
    expect(notPending.status).toBe(409);
    expect(notPending.body.error.code).toBe("LINE_NOT_PENDING");
    await decide(owner, id, lines.line3.id, "approve", termsOf(res.body.order.lines[2]));
    const again = await decide(owner, id, lines.line3.id, "approve", termsOf(res.body.order.lines[2]));
    expect(again.body.error.code).toBe("LINE_NOT_PENDING");
    const missing = await decide(owner, id, randomUUID(), "approve", termsOf(res.body.order.lines[2]));
    expect(missing.status).toBe(404);
  });

  it("reject → line rejected (blocked); save → 422; re-request puts it back to pending", async () => {
    const { owner, adviser, id, lines, res, body } = await pendingOrder();
    const out = await decide(owner, id, lines.line3.id, "reject", termsOf(res.body.order.lines[2]));
    expect(out.body.order.status).toBe("draft");
    expect(out.body.order.lines[2]).toMatchObject({ state: "blocked", approval: { status: "rejected" } });
    const saved = await saveOrder(adviser, id, body);
    expect(saved.status).toBe(422);
    expect(saved.body.error).toMatchObject({ code: "UNAPPROVED_BLOCKED_LINES", details: { lineIds: [lines.line3.id] } });
    const again = await requestApproval(adviser, id, body);
    expect(again.body.order.lines[2].approval.status).toBe("pending");
  });
});

describe("E12 withdraw-approval", () => {
  it("returns the order to draft and pending lines to none", async () => {
    const { adviser, id } = await pendingOrder();
    const res = await withdrawApproval(adviser, id);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe("draft");
    expect(res.body.order.lines.map((l) => l.approval.status)).toEqual(["none", "none", "none"]);
  });

  it("owner cannot withdraw an adviser's request (404); saved order → 409", async () => {
    const { owner, adviser, id } = await pendingOrder();
    expect((await withdrawApproval(owner, id)).status).toBe(404);
    const savedId = randomUUID();
    await saveOrder(adviser, savedId, orderInput([ac1Lines().line1]));
    const res = await withdrawApproval(adviser, savedId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_IMMUTABLE");
  });
});
