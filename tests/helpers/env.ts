import fs from "node:fs";
import path from "node:path";

/** Loads `.env` (if present) without overriding variables already set. */
export function loadDotEnv(): void {
  const file = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export const DEFAULT_TEST_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5434/order_screen_test";

export function testDatabaseUrl(): string {
  loadDotEnv();
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}
