import type { NextConfig } from "next";

// One id per build: used by the service worker (`/sw.js?v=<id>`) to version its caches.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.NEXT_PUBLIC_BUILD_ID ||
  `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  generateBuildId: async () => buildId,
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
};

export default nextConfig;
