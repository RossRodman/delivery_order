"use client";

import { useEffect, useState } from "react";
import { api } from "@/client/api";
import type { UserView } from "@/contracts/api";

export type MeState =
  | { status: "loading" }
  | { status: "authenticated"; user: UserView }
  | { status: "unauthenticated" };

/** Loads the signed-in user (E3). Used to gate owner-only nav/pages and pick up the role. */
export function useMe(): MeState {
  const [state, setState] = useState<MeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api.me().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ status: "authenticated", user: result.data.user });
      } else {
        setState({ status: "unauthenticated" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
