import postgres from "postgres";
import { createDb } from "@/server/db/connect";
import { runMigrations } from "@/server/db/migrate";
import { seed } from "@/server/db/seed";

/** The e2e database URL, explicit and never the production `.env.production.local` one. */
export function e2eDatabaseUrl(): string {
  return process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5434/order_screen_e2e";
}

/** Drops and recreates the e2e schema, migrates, then seeds fixed fixture data. */
export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  } finally {
    await sql.end();
  }
  await runMigrations(url);
  const { db, client } = createDb(url, { max: 1 });
  try {
    await seed(db);
  } finally {
    await client.end();
  }
}
