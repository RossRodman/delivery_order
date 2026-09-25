import { api } from "@/client/api";
import type { Catalog } from "@/contracts/api";
import { getCachedCatalog, setCachedCatalog } from "./db";

/** Online-first catalog load; falls back to the last cached copy when offline (plan.md §8.2). */
export async function loadCatalog(): Promise<Catalog | undefined> {
  const result = await api.catalog();
  if (result.ok) {
    await setCachedCatalog(result.data);
    return result.data;
  }
  return getCachedCatalog();
}
