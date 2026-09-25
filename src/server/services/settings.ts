import "server-only";
import { eq, sql } from "drizzle-orm";
import type { GlobalRateResponse } from "@/contracts/api";
import { getDb } from "@/server/db/client";
import { appSettings } from "@/server/db/schema";
import { assertValidRate } from "./rate";

/** E6 (owner) — R5/R6: global default rate, refused (never clamped) below 8,000. */
export async function setGlobalRate(globalRate: number, userId: string): Promise<GlobalRateResponse> {
  assertValidRate(globalRate);
  const [row] = await getDb()
    .update(appSettings)
    .set({ globalRate, updatedBy: userId, updatedAt: sql`now()` })
    .where(eq(appSettings.id, 1))
    .returning();
  if (!row) throw new Error("app_settings row missing — run the seed");
  return { globalRate: row.globalRate, updatedAt: row.updatedAt.toISOString() };
}
