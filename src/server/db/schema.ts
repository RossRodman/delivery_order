import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["adviser", "owner"]);
export const orderStatus = pgEnum("order_status", ["draft", "pending_approval", "saved"]);
export const approvalStatus = pgEnum("approval_status", ["none", "pending", "approved", "rejected"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
});

export const dealers = pgTable("dealers", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull().unique(),
  city: text("city").notNull(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("products_unit_price_range", sql`${t.unitPriceCents} > 0 AND ${t.unitPriceCents} <= 10000000`),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: smallint("id").primaryKey().default(1),
    globalRate: integer("global_rate").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("app_settings_singleton", sql`${t.id} = 1`),
    check("app_settings_rate_range", sql`${t.globalRate} >= 8000 AND ${t.globalRate} <= 100000`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    number: integer("number").generatedAlwaysAsIdentity().unique(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    dealerId: uuid("dealer_id")
      .notNull()
      .references(() => dealers.id),
    status: orderStatus("status").notNull().default("draft"),
    rate: integer("rate").notNull(),
    totalUsdCents: bigint("total_usd_cents", { mode: "number" }),
    totalSdg: bigint("total_sdg", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    savedAt: timestamp("saved_at", { withTimezone: true }),
  },
  (t) => [
    check("orders_rate_range", sql`${t.rate} >= 8000 AND ${t.rate} <= 100000`),
    check(
      "saved_has_snapshot",
      sql`(${t.status} = 'saved') = (${t.savedAt} IS NOT NULL AND ${t.totalUsdCents} IS NOT NULL AND ${t.totalSdg} IS NOT NULL)`,
    ),
    index("orders_created_by_idx").on(t.createdBy, t.updatedAt.desc()),
    index("orders_status_idx").on(t.status),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    position: integer("position").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qty: integer("qty").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull(),
    approvalStatus: approvalStatus("approval_status").notNull().default("none"),
    approvedProductId: uuid("approved_product_id"),
    approvedQty: integer("approved_qty"),
    approvedUnitPriceCents: integer("approved_unit_price_cents"),
    approvedDiscountCents: bigint("approved_discount_cents", { mode: "number" }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.id] }),
    check("order_lines_position", sql`${t.position} >= 0`),
    check("order_lines_qty_range", sql`${t.qty} >= 1 AND ${t.qty} <= 10000`),
    check("order_lines_unit_price_positive", sql`${t.unitPriceCents} > 0`),
    check("order_lines_discount_non_negative", sql`${t.discountCents} >= 0`),
    check("discount_le_value", sql`${t.discountCents} <= ${t.qty}::bigint * ${t.unitPriceCents}`),
    check(
      "approved_has_terms",
      sql`(${t.approvalStatus} = 'approved') = (${t.approvedProductId} IS NOT NULL AND ${t.approvedQty} IS NOT NULL AND ${t.approvedUnitPriceCents} IS NOT NULL AND ${t.approvedDiscountCents} IS NOT NULL)`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type DealerRow = typeof dealers.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderLineRow = typeof orderLines.$inferSelect;
