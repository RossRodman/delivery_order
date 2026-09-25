import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import type { Catalog, CatalogProduct } from "@/contracts/api";
import { getDb } from "@/server/db/client";
import { appSettings, dealers, products } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

function toProduct(row: typeof products.$inferSelect): CatalogProduct {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unitPriceCents: row.unitPriceCents,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** E4 */
export async function getCatalog(): Promise<Catalog> {
  const db = getDb();
  const [dealerRows, productRows, settingsRows] = await Promise.all([
    db.select().from(dealers).orderBy(asc(dealers.name)),
    db.select().from(products).orderBy(asc(products.sku)),
    db.select({ globalRate: appSettings.globalRate }).from(appSettings).where(eq(appSettings.id, 1)),
  ]);
  if (!settingsRows[0]) throw new Error("app_settings row missing — run the seed");
  return {
    dealers: dealerRows.map((d) => ({ id: d.id, name: d.name, city: d.city })),
    products: productRows.map(toProduct),
    globalRate: settingsRows[0].globalRate,
    fetchedAt: new Date().toISOString(),
  };
}

/** E5 (owner) — R1: the owner sets the fixed USD price. */
export async function updateProductPrice(productId: string, unitPriceCents: number): Promise<CatalogProduct> {
  const [row] = await getDb()
    .update(products)
    .set({ unitPriceCents, updatedAt: sql`now()` })
    .where(eq(products.id, productId))
    .returning();
  if (!row) throw new ApiError("NOT_FOUND");
  return toProduct(row);
}
