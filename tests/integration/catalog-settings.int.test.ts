import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as catalogGet } from "@/app/api/catalog/route";
import { PATCH as pricePatch } from "@/app/api/products/[id]/route";
import { PUT as ratePut } from "@/app/api/settings/global-rate/route";
import type { Catalog, GlobalRateResponse, PriceResponse } from "@/contracts/api";
import { GLOBAL_RATE_BELOW_MINIMUM_MESSAGE } from "@/contracts/errors";
import { closeTestDb, resetAndSeed, testDb } from "../helpers/db";
import { P } from "../helpers/fixtures";
import { adviserToken, buildRequest, call, ownerToken, type ErrorBody } from "../helpers/http";

beforeEach(resetAndSeed);
afterAll(closeTestDb);

const getCatalog = async (token: string) => call<Catalog>(catalogGet, buildRequest("GET", "/api/catalog", { token }));
const putRate = async (token: string, globalRate: unknown) =>
  call<GlobalRateResponse & ErrorBody>(ratePut, buildRequest("PUT", "/api/settings/global-rate", { token, body: { globalRate } }));
const patchPrice = async (token: string, id: string, unitPriceCents: unknown) =>
  call<PriceResponse & ErrorBody>(pricePatch, buildRequest("PATCH", `/api/products/${id}`, { token, body: { unitPriceCents } }), { id });

describe("E4 catalog", () => {
  it("returns seeded dealers, products and globalRate 8200 with no-store", async () => {
    const res = await getCatalog(await adviserToken());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body.globalRate).toBe(8200);
    expect(res.body.dealers.map((d) => d.name)).toEqual([
      "Al-Noor Trading",
      "Blue Nile Traders",
      "Kordofan Supplies",
      "Red Sea Agro",
    ]);
    expect(res.body.products.find((p) => p.sku === "BATT-03")).toMatchObject({
      id: P.battery.id,
      name: "Battery",
      unitPriceCents: 207000,
    });
    expect(res.body.products).toHaveLength(5);
  });

  it("requires authentication", async () => {
    const res = await call<ErrorBody>(catalogGet, buildRequest("GET", "/api/catalog"));
    expect(res.status).toBe(401);
  });
});

describe("E5 product price (owner)", () => {
  it("owner PATCH → 200 and reflected in the catalog", async () => {
    const token = await ownerToken();
    const res = await patchPrice(token, P.pump.id, 52000);
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({ id: P.pump.id, unitPriceCents: 52000 });
    const catalog = await getCatalog(token);
    expect(catalog.body.products.find((p) => p.id === P.pump.id)?.unitPriceCents).toBe(52000);
  });

  it("price 0, negative, fractional or too large → 400", async () => {
    const token = await ownerToken();
    for (const value of [0, -1, 100.5, 10_000_001, "5000"]) {
      const res = await patchPrice(token, P.pump.id, value);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("unknown product → 404", async () => {
    const res = await patchPrice(await ownerToken(), randomUUID(), 5000);
    expect(res.status).toBe(404);
  });
});

describe("E6 global rate (owner)", () => {
  it("owner PUT 9,000 → 200 and reflected in the catalog", async () => {
    const token = await ownerToken();
    const res = await putRate(token, 9000);
    expect(res.status).toBe(200);
    expect(res.body.globalRate).toBe(9000);
    expect((await getCatalog(token)).body.globalRate).toBe(9000);
  });

  it("PUT 7,999 → 422 RATE_BELOW_MINIMUM and the value is unchanged (no clamp)", async () => {
    const token = await ownerToken();
    const res = await putRate(token, 7999);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "RATE_BELOW_MINIMUM", details: { min: 8000 } });
    // Settings copy, not the order-screen copy (review m-7).
    expect(res.body.error.message).toBe(GLOBAL_RATE_BELOW_MINIMUM_MESSAGE);
    expect(res.body.error.message).not.toMatch(/order/i);
    const [row] = await testDb().sql`SELECT global_rate FROM app_settings`;
    expect(row.global_rate).toBe(8200);
  });

  it("PUT 8,000 is accepted; 100,001 → 422 RATE_ABOVE_MAXIMUM; 8000.5 → 400", async () => {
    const token = await ownerToken();
    expect((await putRate(token, 8000)).status).toBe(200);
    const high = await putRate(token, 100001);
    expect(high.status).toBe(422);
    expect(high.body.error.code).toBe("RATE_ABOVE_MAXIMUM");
    expect((await putRate(token, 8000.5)).status).toBe(400);
  });
});
