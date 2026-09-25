import fs from "node:fs";

/** Loads .env for CLI scripts (Next loads it itself for the app). Existing vars win. */
export function loadEnv(): void {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
}

/** Migrations/seed prefer DIRECT_URL (Supabase session pooler), else DATABASE_URL. */
export function migrationUrl(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (or DIRECT_URL)");
  return url;
}
