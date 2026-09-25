"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { UserView } from "@/contracts/api";
import { getCachedMe, setCachedMe } from "@/client/offline/db";

export type MeState =
  | { status: "loading" }
  | { status: "authenticated"; user: UserView }
  | { status: "unauthenticated" };

/**
 * Loads the signed-in user (E3). Used to gate owner-only nav/pages and pick up the role.
 * A network failure (offline) is NOT the same as "not authenticated": it falls back to the
 * last-known signed-in user cached in IndexedDB, so an offline reload never bounces a valid
 * session to /login (which itself would never have been cached — plan.md §8.1/§8.2).
 */
export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api.me().then(async (result) => {
      if (cancelled) return;
      if (result.ok) {
        await setCachedMe(result.data.user);
        setState({ status: "authenticated", user: result.data.user });
        return;
      }
      if (result.error.code === "NETWORK") {
        const cached = await getCachedMe();
        if (cancelled) return;
        setState(cached ? { status: "authenticated", user: cached } : { status: "loading" });
        return;
      }
      setState({ status: "unauthenticated" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
