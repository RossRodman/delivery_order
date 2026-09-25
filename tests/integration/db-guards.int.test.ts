import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { AC1, AMINA, DEALER, insertDraft, YUSUF } from "../helpers/fixtures";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const { sql } = testDb();

beforeEach(resetAndSeed);
afterAll(closeTestDb);

async function saveRaw(orderId: string, usd: number, sdg: number) {
  await sql`UPDATE orders SET status = 'saved', total_usd_cents = ${usd}, total_sdg = ${sdg}, saved_at = now()
            WHERE id = ${orderId}`;
}

async function status(orderId: string) {
  const [row] = await sql`SELECT status FROM orders WHERE id = ${orderId}`;
  return row?.status as string | undefined;
}

async function approveRaw(orderId: string, lineId: string, deciderId: string = YUSUF.id) {
  await sql`UPDATE order_lines SET approval_status = 'pending' WHERE order_id = ${orderId} AND id = ${lineId}`;
  await sql`UPDATE order_lines SET approval_status = 'approved', approved_product_id = product_id,
              approved_qty = qty, approved_unit_price_cents = unit_price_cents,
              approved_discount_cents = discount_cents, decided_by = ${deciderId}, decided_at = now()
            WHERE order_id = ${orderId} AND id = ${lineId}`;
}

describe("CHECK constraints", () => {
  it("rate 7,999 is refused on orders and app_settings (R5)", async () => {
    await expect(
      sql`INSERT INTO orders (id, created_by, dealer_id, rate) VALUES (${randomUUID()}, ${AMINA.id}, ${DEALER.id}, 7999)`,
    ).rejects.toMatchObject({ code: "23514", constraint_name: "orders_rate_range" });
    await expect(sql`UPDATE app_settings SET global_rate = 7999`).rejects.toMatchObject({
      code: "23514",
      constraint_name: "app_settings_rate_range",
    });
  });

  it("qty 0 and discount > value are refused (R2)", async () => {
    const { orderId } = await insertDraft([]);
    await expect(
      sql`INSERT INTO order_lines (order_id, id, position, product_id, qty, unit_price_cents, discount_cents)
          VALUES (${orderId}, ${randomUUID()}, 0, ${AC1.line1.productId}, 0, 51500, 0)`,
    ).rejects.toMatchObject({ code: "23514", constraint_name: "order_lines_qty_range" });
    await expect(
      sql`INSERT INTO order_lines (order_id, id, position, product_id, qty, unit_price_cents, discount_cents)
          VALUES (${orderId}, ${randomUUID()}, 0, ${AC1.line1.productId}, 1, 51500, 51501)`,
    ).rejects.toMatchObject({ code: "23514", constraint_name: "discount_le_value" });
  });
});

describe("orders_insert_guard", () => {
  it("an order cannot be inserted as saved (OS422)", async () => {
    const id = randomUUID();
    await expect(
      sql`INSERT INTO orders (id, created_by, dealer_id, rate, status, total_usd_cents, total_sdg, saved_at)
          VALUES (${id}, ${AMINA.id}, ${DEALER.id}, 8200, 'saved', 0, 0, now())`,
    ).rejects.toMatchObject({ code: "OS422" });
    expect(await status(id)).toBeUndefined();
  });
});

describe("orders_validate_save (AC2 DB-level guard)", () => {
  it("refuses saving with an unapproved 7.25% line and names it in DETAIL", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line1, AC1.line2, AC1.line3]);
    await expect(saveRaw(orderId, 549000, 45018000)).rejects.toMatchObject({
      code: "OS422",
      message: "UNAPPROVED_BLOCKED_LINES",
      detail: lineIds[2],
    });
    expect(await status(orderId)).toBe("draft");
  });

  it("allows saving when the blocked line is approved with matching terms (AC1 full)", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line1, AC1.line2, AC1.line3]);
    await approveRaw(orderId, lineIds[2]);
    await saveRaw(orderId, 549000, 45018000);
    expect(await status(orderId)).toBe("saved");
  });

  it("allows saving AC1 lines 1–2 with correct totals", async () => {
    const { orderId } = await insertDraft([AC1.line1, AC1.line2]);
    await saveRaw(orderId, 357000, 29274000);
    expect(await status(orderId)).toBe("saved");
  });

  it("refuses an approval whose stored terms no longer match", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line3]);
    await approveRaw(orderId, lineIds[0]);
    // Tampering with the approved terms directly is itself refused (m-3 guard) …
    await expect(sql`UPDATE order_lines SET approved_discount_cents = 14000 WHERE id = ${lineIds[0]}`).rejects.toMatchObject({
      code: "OS422",
      message: "APPROVAL_REQUIRES_OWNER",
    });
    // … and with the guard bypassed (session_replication_role=replica skips user triggers),
    // the save guard still compares approved terms with the current terms.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE order_lines SET approved_discount_cents = 14000 WHERE id = ${lineIds[0]}`;
    });
    await expect(saveRaw(orderId, 192000, 15744000)).rejects.toMatchObject({
      code: "OS422",
      message: "UNAPPROVED_BLOCKED_LINES",
    });
  });

  it("refuses an empty order (OS422 EMPTY_ORDER)", async () => {
    const { orderId } = await insertDraft([]);
    await expect(saveRaw(orderId, 0, 0)).rejects.toMatchObject({ code: "OS422", message: "EMPTY_ORDER" });
  });

  it("refuses a unit price that differs from the product price (OS422 PRICE_MISMATCH)", async () => {
    const { orderId, lineIds } = await insertDraft([{ ...AC1.line1, unitPriceCents: 50_000 }]);
    await expect(saveRaw(orderId, 196000, 16072000)).rejects.toMatchObject({
      code: "OS422",
      message: "PRICE_MISMATCH",
      detail: lineIds[0],
    });
  });

  it("refuses wrong totals (OS500)", async () => {
    const { orderId } = await insertDraft([AC1.line1, AC1.line2]);
    await expect(saveRaw(orderId, 357001, 29274082)).rejects.toMatchObject({
      code: "OS500",
      message: "TOTALS_MISMATCH",
    });
    await expect(saveRaw(orderId, 357000, 29274001)).rejects.toMatchObject({ code: "OS500" });
  });
});

describe("immutability of saved orders (R7, AC4)", () => {
  async function savedOrder() {
    const { orderId, lineIds } = await insertDraft([AC1.line1, AC1.line2]);
    await saveRaw(orderId, 357000, 29274000);
    return { orderId, lineIds };
  }

  it("UPDATE and DELETE of a saved order raise OS409", async () => {
    const { orderId } = await savedOrder();
    await expect(sql`UPDATE orders SET rate = 9000 WHERE id = ${orderId}`).rejects.toMatchObject({ code: "OS409" });
    await expect(sql`UPDATE orders SET status = 'draft', saved_at = NULL, total_usd_cents = NULL, total_sdg = NULL WHERE id = ${orderId}`).rejects.toMatchObject({ code: "OS409" });
    await expect(sql`DELETE FROM orders WHERE id = ${orderId}`).rejects.toMatchObject({ code: "OS409" });
  });

  it("INSERT/UPDATE/DELETE of a saved order's lines raise OS409", async () => {
    const { orderId, lineIds } = await savedOrder();
    await expect(
      sql`INSERT INTO order_lines (order_id, id, position, product_id, qty, unit_price_cents, discount_cents)
          VALUES (${orderId}, ${randomUUID()}, 5, ${AC1.line1.productId}, 1, 51500, 0)`,
    ).rejects.toMatchObject({ code: "OS409" });
    await expect(sql`UPDATE order_lines SET unit_price_cents = 1 WHERE id = ${lineIds[0]}`).rejects.toMatchObject({
      code: "OS409",
    });
    await expect(sql`DELETE FROM order_lines WHERE id = ${lineIds[0]}`).rejects.toMatchObject({ code: "OS409" });
  });
});

describe("order_lines_void_approval (R4, AC6)", () => {
  it("a terms update on an approved line clears the approval", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line3]);
    await approveRaw(orderId, lineIds[0]);
    await sql`UPDATE order_lines SET discount_cents = 15100 WHERE id = ${lineIds[0]}`;
    const [row] = await sql`SELECT approval_status, approved_qty, decided_by FROM order_lines WHERE id = ${lineIds[0]}`;
    expect(row).toMatchObject({ approval_status: "none", approved_qty: null, decided_by: null });
  });

  it("an update with identical terms keeps the approval (M-1)", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line3]);
    await approveRaw(orderId, lineIds[0]);
    await sql`UPDATE order_lines SET qty = 1, discount_cents = 15000, position = 3 WHERE id = ${lineIds[0]}`;
    const [row] = await sql`SELECT approval_status FROM order_lines WHERE id = ${lineIds[0]}`;
    expect(row.approval_status).toBe("approved");
  });
});

describe("order_lines_approval_guard (review m-3)", () => {
  it("an adviser cannot self-approve in SQL, so the save stays refused", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line3]);
    await expect(approveRaw(orderId, lineIds[0], AMINA.id)).rejects.toMatchObject({
      code: "OS422",
      message: "APPROVAL_REQUIRES_OWNER",
    });
    await expect(saveRaw(orderId, 192000, 15744000)).rejects.toMatchObject({
      code: "OS422",
      message: "UNAPPROVED_BLOCKED_LINES",
    });
  });

  it("approval must follow a pending request and carry decided_at", async () => {
    const { lineIds } = await insertDraft([AC1.line3]);
    await expect(
      sql`UPDATE order_lines SET approval_status = 'approved', approved_product_id = product_id, approved_qty = qty,
            approved_unit_price_cents = unit_price_cents, approved_discount_cents = discount_cents,
            decided_by = ${YUSUF.id}, decided_at = now() WHERE id = ${lineIds[0]}`,
    ).rejects.toMatchObject({ code: "OS422", message: "APPROVAL_REQUIRES_OWNER" });
    await sql`UPDATE order_lines SET approval_status = 'pending' WHERE id = ${lineIds[0]}`;
    await expect(
      sql`UPDATE order_lines SET approval_status = 'approved', approved_product_id = product_id, approved_qty = qty,
            approved_unit_price_cents = unit_price_cents, approved_discount_cents = discount_cents,
            decided_by = ${YUSUF.id} WHERE id = ${lineIds[0]}`,
    ).rejects.toMatchObject({ code: "OS422", message: "APPROVAL_REQUIRES_OWNER" });
  });

  it("a line cannot be inserted as approved", async () => {
    const { orderId } = await insertDraft([]);
    await expect(
      sql`INSERT INTO order_lines (order_id, id, position, product_id, qty, unit_price_cents, discount_cents,
            approval_status, approved_product_id, approved_qty, approved_unit_price_cents, approved_discount_cents,
            decided_by, decided_at)
          VALUES (${orderId}, ${randomUUID()}, 0, ${AC1.line3.productId}, 1, 207000, 15000,
            'approved', ${AC1.line3.productId}, 1, 207000, 15000, ${YUSUF.id}, now())`,
    ).rejects.toMatchObject({ code: "OS422", message: "APPROVAL_REQUIRES_OWNER" });
  });

  it("an existing approval survives a position-only update but cannot be rewritten", async () => {
    const { orderId, lineIds } = await insertDraft([AC1.line3]);
    await approveRaw(orderId, lineIds[0]);
    await sql`UPDATE order_lines SET position = 7 WHERE id = ${lineIds[0]}`;
    await expect(
      sql`UPDATE order_lines SET decided_by = ${AMINA.id} WHERE id = ${lineIds[0]}`,
    ).rejects.toMatchObject({ code: "OS422", message: "APPROVAL_REQUIRES_OWNER" });
  });
});

describe("order_lines_immutable_guard locks the parent order (review m-2)", () => {
  it("a line inserted concurrently with the save transition waits and is refused (OS409)", async () => {
    const { orderId } = await insertDraft([AC1.line1]);
    const url = process.env.DATABASE_URL!;
    const s1 = postgres(url, { max: 1, onnotice: () => {} });
    const s2 = postgres(url, { max: 1, onnotice: () => {} });
    try {
      let releaseT1!: () => void;
      const t1Gate = new Promise<void>((resolve) => (releaseT1 = resolve));
      let t1Updated!: () => void;
      const t1Ready = new Promise<void>((resolve) => (t1Updated = resolve));
      const t1 = s1.begin(async (tx) => {
        await tx`UPDATE orders SET status = 'saved', total_usd_cents = 202000, total_sdg = 16564000, saved_at = now()
                 WHERE id = ${orderId}`;
        t1Updated();
        await t1Gate;
      });
      await t1Ready;
      // 72% discount line: would make the saved order invalid if it slipped in.
      let t2Done = false;
      const t2 = s2
        .begin(async (tx) => {
          await tx`INSERT INTO order_lines (order_id, id, position, product_id, qty, unit_price_cents, discount_cents)
                   VALUES (${orderId}, ${randomUUID()}, 1, ${AC1.line3.productId}, 1, 207000, 150000)`;
        })
        .finally(() => {
          t2Done = true;
        });
      const t2Settled = t2.then(
        () => null,
        (err: unknown) => err,
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(t2Done).toBe(false); // blocked on the parent row lock
      releaseT1();
      await t1;
      expect(await t2Settled).toMatchObject({ code: "OS409" });
      const lines = await sql`SELECT id FROM order_lines WHERE order_id = ${orderId}`;
      expect(lines).toHaveLength(1);
      expect(await status(orderId)).toBe("saved");
    } finally {
      await s1.end();
      await s2.end();
    }
  });
});
