import { runMigrations } from "../src/server/db/migrate";
import { loadEnv, migrationUrl } from "./env";

async function main() {
  loadEnv();
  const url = new URL(migrationUrl());
  await runMigrations(url.toString());
  console.log(`Migrations applied to ${url.host}${url.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
