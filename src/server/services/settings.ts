import "server-only";
import { eq, sql } from "drizzle-orm";
import type { GlobalRateResponse } from "@/contracts/api";
import { GLOBAL_RATE_BELOW_MINIMUM_MESSAGE } from "@/contracts/errors";
import { ApiError } from "@/server/http/errors";
import { getDb } from "@/server/db/client";
import { appSettings } from "@/server/db/schema";
import { assertValidRate } from "./rate";

/** E6 (owner) — R5/R6: global default rate, refused (never clamped) below 8,000. */
export async function setGlobalRate(globalRate: number, userId: string): Promise<GlobalRateResponse> {
  try {
    assertValidRate(globalRate);
  } catch (err) {
    if (err instanceof ApiError && err.code === "RATE_BELOW_MINIMUM") {
      throw new ApiError("RATE_BELOW_MINIMUM", { message: GLOBAL_RATE_BELOW_MINIMUM_MESSAGE, details: err.details });
    }
    throw err;
  }
  const [row] = await getDb()
    .update(appSettings)
    .set({ globalRate, updatedBy: userId, updatedAt: sql`now()` })
    .where(eq(appSettings.id, 1))
    .returning();
  if (!row) throw new Error("app_settings row missing — run the seed");
  return { globalRate: row.globalRate, updatedAt: row.updatedAt.toISOString() };
}
