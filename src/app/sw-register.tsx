"use client";

import { useEffect } from "react";
import { api } from "@/client/api";

/**
 * Registers the service worker only once the user is confirmed signed in (plan.md §8.1): the SW
 * must never observe the unauthenticated `/login` shell as the cached copy of an offline-capable
 * page. Production only — `next dev` doesn't produce the static assets the SW caches.
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    api.me().then((result) => {
      if (cancelled || !result.ok) return;
      const version = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
      navigator.serviceWorker.register(`/sw.js?v=${version}`).catch(() => {
        // Best-effort: offline support degrades gracefully without a registered SW.
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
