import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { AC1, AMINA, DEALER, insertDraft, YUSUF } from "../helpers/fixtures";
import { randomUUID } from "node:crypto";

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

async function approveRaw(orderId: string, lineId: string) {
  await sql`UPDATE order_lines SET approval_status = 'approved', approved_product_id = product_id,
              approved_qty = qty, approved_unit_price_cents = unit_price_cents,
              approved_discount_cents = discount_cents, decided_by = ${YUSUF.id}, decided_at = now()
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
    // Tamper with the approved terms directly (the app never does this).
    await sql`UPDATE order_lines SET approved_discount_cents = 14000 WHERE id = ${lineIds[0]}`;
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
