import type { Db } from "./connect";
import { appSettings, dealers, products, users } from "./schema";
import { SEED_DEALERS, SEED_GLOBAL_RATE, SEED_PRODUCTS, SEED_USERS } from "./seed-data";

/**
 * Idempotent seed: `INSERT … ON CONFLICT DO NOTHING` everywhere, so it never overwrites an
 * owner-edited price or rate.
 */
export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(users).values(Object.values(SEED_USERS)).onConflictDoNothing();
    await tx.insert(dealers).values(Object.values(SEED_DEALERS)).onConflictDoNothing();
    await tx.insert(products).values(Object.values(SEED_PRODUCTS)).onConflictDoNothing();
    await tx.insert(appSettings).values({ id: 1, globalRate: SEED_GLOBAL_RATE }).onConflictDoNothing();
  });
}
