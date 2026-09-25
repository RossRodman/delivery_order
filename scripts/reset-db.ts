/**
 * Local/test only: drop the public + drizzle schemas, re-apply migrations, seed.
 * Refuses when NODE_ENV=production or the database host is not localhost.
 */
import postgres from "postgres";
import { createDb, isLocalUrl } from "../src/server/db/connect";
import { runMigrations } from "../src/server/db/migrate";
import { seed } from "../src/server/db/seed";
import { loadEnv, migrationUrl } from "./env";

export function assertResettable(url: string, nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === "production") throw new Error("db:reset refused: NODE_ENV=production");
  if (!isLocalUrl(url)) throw new Error(`db:reset refused: host ${new URL(url).host} is not localhost`);
}

async function main() {
  loadEnv();
  const url = process.argv[2] ?? migrationUrl();
  assertResettable(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
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
  console.log(`Reset ${new URL(url).host}${new URL(url).pathname}: migrated + seeded`);
}

if (process.argv[1]?.endsWith("reset-db.ts")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
