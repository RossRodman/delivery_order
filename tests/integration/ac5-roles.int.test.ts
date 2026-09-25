import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as pricePatch } from "@/app/api/products/[id]/route";
import { PUT as ratePut } from "@/app/api/settings/global-rate/route";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";
import { adviserToken, buildRequest, call, type ErrorBody } from "../helpers/http";

beforeEach(resetAndSeed);
afterAll(closeTestDb);

const { sql } = testDb();

describe("AC5 — adviser cannot change prices or the global rate", () => {
  it("adviser PATCH price → 403 FORBIDDEN, DB unchanged", async () => {
    const token = await adviserToken();
    const res = await call<ErrorBody>(
      pricePatch,
      buildRequest("PATCH", `/api/products/${P.battery.id}`, { token, body: { unitPriceCents: 1, role: "owner" } }),
      { id: P.battery.id },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    const [row] = await sql`SELECT unit_price_cents FROM products WHERE id = ${P.battery.id}`;
    expect(row.unit_price_cents).toBe(207000);
  });

  it("adviser PUT global rate → 403 FORBIDDEN, DB unchanged", async () => {
    const token = await adviserToken();
    const res = await call<ErrorBody>(
      ratePut,
      buildRequest("PUT", "/api/settings/global-rate", { token, body: { globalRate: 9000, role: "owner" } }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    const [row] = await sql`SELECT global_rate FROM app_settings`;
    expect(row.global_rate).toBe(8200);
  });

  it("no token → 401; tampered token → 401", async () => {
    const none = await call<ErrorBody>(ratePut, buildRequest("PUT", "/api/settings/global-rate", { body: { globalRate: 9000 } }));
    expect(none.status).toBe(401);
    const token = await adviserToken();
    const tampered = token.slice(0, -3) + (token.endsWith("aaa") ? "bbb" : "aaa");
    const bad = await call<ErrorBody>(
      pricePatch,
      buildRequest("PATCH", `/api/products/${P.pump.id}`, { token: tampered, body: { unitPriceCents: 1 } }),
      { id: P.pump.id },
    );
    expect(bad.status).toBe(401);
  });
});
