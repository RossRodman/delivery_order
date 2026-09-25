import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./connect";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

/** Applies drizzle/ migrations to the given database URL. */
export async function runMigrations(url: string): Promise<void> {
  const { db, client } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}
