import { createDb } from "../src/server/db/connect";
import { seed } from "../src/server/db/seed";
import { loadEnv, migrationUrl } from "./env";

async function main() {
  loadEnv();
  const url = migrationUrl();
  const { db, client } = createDb(url, { max: 1 });
  try {
    await seed(db);
    console.log(`Seeded ${new URL(url).host}${new URL(url).pathname} (existing rows left untouched)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
