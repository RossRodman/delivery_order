CREATE TYPE "public"."approval_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending_approval', 'saved');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('adviser', 'owner');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"global_rate" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "app_settings_rate_range" CHECK ("app_settings"."global_rate" >= 8000 AND "app_settings"."global_rate" <= 100000)
);
--> statement-breakpoint
CREATE TABLE "dealers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	CONSTRAINT "dealers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"order_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"discount_cents" bigint NOT NULL,
	"approval_status" "approval_status" DEFAULT 'none' NOT NULL,
	"approved_product_id" uuid,
	"approved_qty" integer,
	"approved_unit_price_cents" integer,
	"approved_discount_cents" bigint,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "order_lines_order_id_id_pk" PRIMARY KEY("order_id","id"),
	CONSTRAINT "order_lines_position" CHECK ("order_lines"."position" >= 0),
	CONSTRAINT "order_lines_qty_range" CHECK ("order_lines"."qty" >= 1 AND "order_lines"."qty" <= 10000),
	CONSTRAINT "order_lines_unit_price_positive" CHECK ("order_lines"."unit_price_cents" > 0),
	CONSTRAINT "order_lines_discount_non_negative" CHECK ("order_lines"."discount_cents" >= 0),
	CONSTRAINT "discount_le_value" CHECK ("order_lines"."discount_cents" <= "order_lines"."qty"::bigint * "order_lines"."unit_price_cents"),
	CONSTRAINT "approved_has_terms" CHECK (("order_lines"."approval_status" = 'approved') = ("order_lines"."approved_product_id" IS NOT NULL AND "order_lines"."approved_qty" IS NOT NULL AND "order_lines"."approved_unit_price_cents" IS NOT NULL AND "order_lines"."approved_discount_cents" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"created_by" uuid NOT NULL,
	"dealer_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"rate" integer NOT NULL,
	"total_usd_cents" bigint,
	"total_sdg" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_rate_range" CHECK ("orders"."rate" >= 8000 AND "orders"."rate" <= 100000),
	CONSTRAINT "saved_has_snapshot" CHECK (("orders"."status" = 'saved') = ("orders"."saved_at" IS NOT NULL AND "orders"."total_usd_cents" IS NOT NULL AND "orders"."total_sdg" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_unit_price_range" CHECK ("products"."unit_price_cents" > 0 AND "products"."unit_price_cents" <= 10000000)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_created_by_idx" ON "orders" USING btree ("created_by","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");