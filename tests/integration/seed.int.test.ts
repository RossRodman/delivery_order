import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "@/server/db/seed";
import { assertResettable } from "../../scripts/reset-db";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";

const { db, sql } = testDb();

beforeEach(resetAndSeed);
afterAll(closeTestDb);

describe("seed", () => {
  it("creates the plan §4.3 rows", async () => {
    const products = await sql`SELECT sku, unit_price_cents FROM products ORDER BY sku`;
    const prices = Object.fromEntries(products.map((p) => [p.sku, p.unit_price_cents]));
    expect(prices).toMatchObject({ "PUMP-01": 51500, "FILT-02": 81000, "BATT-03": 207000 });
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM dealers`;
    expect(count).toBeGreaterThanOrEqual(3);
    const users = await sql`SELECT name, role FROM users ORDER BY name`;
    expect(users.map((u) => [u.name, u.role])).toEqual([
      ["Amina", "adviser"],
      ["Yusuf", "owner"],
    ]);
    const [settings] = await sql`SELECT global_rate FROM app_settings`;
    expect(settings.global_rate).toBe(8200);
  });

  it("is idempotent and never overwrites an edited price or rate", async () => {
    await sql`UPDATE products SET unit_price_cents = 60000 WHERE id = ${P.pump.id}`;
    await sql`UPDATE app_settings SET global_rate = 9000`;
    const before = await sql`SELECT (SELECT count(*) FROM products) p, (SELECT count(*) FROM dealers) d, (SELECT count(*) FROM users) u`;
    await seed(db);
    await seed(db);
    const after = await sql`SELECT (SELECT count(*) FROM products) p, (SELECT count(*) FROM dealers) d, (SELECT count(*) FROM users) u`;
    expect(after).toEqual(before);
    const [pump] = await sql`SELECT unit_price_cents FROM products WHERE id = ${P.pump.id}`;
    expect(pump.unit_price_cents).toBe(60000);
    const [settings] = await sql`SELECT global_rate FROM app_settings`;
    expect(settings.global_rate).toBe(9000);
  });
});

describe("reset-db safety", () => {
  it("refuses production and non-local hosts", () => {
    expect(() => assertResettable("postgres://u:p@localhost:5434/x", "production")).toThrow(/production/);
    expect(() => assertResettable("postgres://u:p@db.example.supabase.co:5432/postgres", "development")).toThrow(
      /not localhost/,
    );
    expect(() => assertResettable("postgres://u:p@localhost:5434/x", "development")).not.toThrow();
  });
});
