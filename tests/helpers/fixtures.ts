import { randomUUID } from "node:crypto";
import { SEED_DEALERS, SEED_PRODUCTS, SEED_USERS } from "@/server/db/seed-data";
import { testDb } from "./db";

export const AMINA = SEED_USERS.amina;
export const YUSUF = SEED_USERS.yusuf;
export const DEALER = SEED_DEALERS.alNoor;
export const P = SEED_PRODUCTS;

export interface RawLine {
  id?: string;
  productId: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
}

/** Inserts a draft order with lines directly via SQL (bypassing the API). */
export async function insertDraft(
  lines: RawLine[],
  opts: { id?: string; createdBy?: string; rate?: number } = {},
): Promise<{ orderId: string; lineIds: string[] }> {
  const { sql } = testDb();
  const orderId = opts.id ?? randomUUID();
  await sql`INSERT INTO orders (id, created_by, dealer_id, rate)
            VALUES (${orderId}, ${opts.createdBy ?? AMINA.id}, ${DEALER.id}, ${opts.rate ?? 8200})`;
  const lineIds: string[] = [];
  for (const [position, line] of lines.entries()) {
    const id = line.id ?? randomUUID();
    lineIds.push(id);
    await sql`INSERT INTO order_lines (order_id, id, position, product_id, qty, unit_price_cents, discount_cents)
              VALUES (${orderId}, ${id}, ${position}, ${line.productId}, ${line.qty}, ${line.unitPriceCents}, ${line.discountCents})`;
  }
  return { orderId, lineIds };
}

/** AC1 lines as raw DB rows. */
export const AC1 = {
  line1: { productId: P.pump.id, qty: 4, unitPriceCents: 51_500, discountCents: 4_000 },
  line2: { productId: P.filter.id, qty: 2, unitPriceCents: 81_000, discountCents: 7_000 },
  line3: { productId: P.battery.id, qty: 1, unitPriceCents: 207_000, discountCents: 15_000 },
};
