import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as pricePatch } from "@/app/api/products/[id]/route";
import { PUT as ratePut } from "@/app/api/settings/global-rate/route";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";
import { adviserToken, buildRequest, call, ownerToken } from "../helpers/http";
import { ac1Lines, getOrder, orderInput, saveOrder } from "../helpers/orders";

const { sql } = testDb();

beforeEach(resetAndSeed);
afterAll(closeTestDb);

describe("AC4 — saved orders keep their rate, prices and totals", () => {
  it("owner changes global rate to 9,000 and a price → saved order unchanged", async () => {
    const adviser = await adviserToken();
    const owner = await ownerToken();
    const id = randomUUID();
    const { line1, line2 } = ac1Lines();
    const saved = await saveOrder(adviser, id, orderInput([line1, line2]));
    expect(saved.status).toBe(200);

    const rate = await call(ratePut, buildRequest("PUT", "/api/settings/global-rate", { token: owner, body: { globalRate: 9000 } }));
    expect(rate.status).toBe(200);
    const price = await call(
      pricePatch,
      buildRequest("PATCH", `/api/products/${P.pump.id}`, { token: owner, body: { unitPriceCents: 60000 } }),
      { id: P.pump.id },
    );
    expect(price.status).toBe(200);

    const read = await getOrder(adviser, id);
    expect(read.body.rate).toBe(8200);
    expect(read.body.lines.map((l) => l.unitPriceCents)).toEqual([51500, 81000]);
    expect(read.body.totals).toEqual({ usdCents: 357000, sdg: 29274000 });
    expect(read.body).toEqual({ ...saved.body.order, updatedAt: read.body.updatedAt });
  });

  it("raw SQL cannot change a saved order or its lines (OS409)", async () => {
    const adviser = await adviserToken();
    const id = randomUUID();
    const { line1 } = ac1Lines();
    await saveOrder(adviser, id, orderInput([line1]));
    await expect(sql`UPDATE orders SET rate = 9000 WHERE id = ${id}`).rejects.toMatchObject({ code: "OS409" });
    await expect(sql`UPDATE order_lines SET unit_price_cents = 60000 WHERE id = ${line1.id}`).rejects.toMatchObject({ code: "OS409" });
  });
});
