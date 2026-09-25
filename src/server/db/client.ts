import "server-only";
import { createDb, type Db } from "./connect";

type Holder = { db: Db; url: string };
const globalForDb = globalThis as unknown as { __orderScreenDb?: Holder };

/** Process-wide singleton (survives Next dev hot reloads). */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const existing = globalForDb.__orderScreenDb;
  if (existing && existing.url === url) return existing.db;
  const { db } = createDb(url);
  globalForDb.__orderScreenDb = { db, url };
  return db;
}

export type { Db };
