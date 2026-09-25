import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as pricePatch } from "@/app/api/products/[id]/route";
import { PUT as ratePut } from "@/app/api/settings/global-rate/route";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";
import { adviserToken, buildRequest, call, type ErrorBody } from "../helpers/http";
import { ac1Lines, decide, getOrder, orderInput, requestApproval, termsOf } from "../helpers/orders";
import { randomUUID } from "node:crypto";

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

  it("adviser cannot approve a line (403), not even their own; DB unchanged", async () => {
    const token = await adviserToken();
    const id = randomUUID();
    const { line1, line3 } = ac1Lines();
    const res = await requestApproval(token, id, orderInput([line1, line3]));
    const out = await decide(token, id, line3.id, "approve", termsOf(res.body.order.lines[1]));
    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe("FORBIDDEN");
    const [row] = await sql`SELECT approval_status FROM order_lines WHERE id = ${line3.id}`;
    expect(row.approval_status).toBe("pending");
    expect((await getOrder(token, id)).body.status).toBe("pending_approval");
  });
});
