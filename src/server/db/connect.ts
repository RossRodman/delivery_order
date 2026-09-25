import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

/**
 * Creates a postgres-js pool + drizzle instance. `prepare: false` keeps it compatible with
 * Supabase's transaction pooler; TLS is required in production (plan §10, m-1).
 * Not marked server-only so CLI scripts (seed, reset) can use it.
 */
export function createDb(url: string, options: { max?: number } = {}) {
  const production = process.env.NODE_ENV === "production";
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? (production ? 3 : 10),
    ssl: production && !isLocalUrl(url) ? "require" : undefined,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}
