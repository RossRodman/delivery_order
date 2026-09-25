import postgres from "postgres";
import { createDb, type Db } from "@/server/db/connect";
import { runMigrations } from "@/server/db/migrate";
import { seed } from "@/server/db/seed";
import { testDatabaseUrl } from "./env";

/** Drops everything in the test database and re-applies all migrations. */
export async function recreateSchema(url = testDatabaseUrl()): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await sql.end();
  }
  await runMigrations(url);
}

let shared: { db: Db; sql: postgres.Sql } | null = null;

/** A connection for test assertions / raw SQL, separate from the app's singleton. */
export function testDb(): { db: Db; sql: postgres.Sql } {
  if (!shared) {
    const { db, client } = createDb(testDatabaseUrl(), { max: 2 });
    shared = { db, sql: client };
  }
  return shared;
}

/** TRUNCATE bypasses row triggers, so saved orders are wiped too. */
export async function truncateAll(): Promise<void> {
  await testDb().sql.unsafe(
    "TRUNCATE order_lines, orders, app_settings, products, dealers, users RESTART IDENTITY CASCADE",
  );
}

export async function resetAndSeed(): Promise<void> {
  await truncateAll();
  await seed(testDb().db);
}

export async function closeTestDb(): Promise<void> {
  if (shared) {
    await shared.sql.end();
    shared = null;
  }
}
