import { defineConfig, devices } from "@playwright/test";

// Two specs only (plan.md §9, B-3): AC1 and AC7, run against a production build so the
// hand-written service worker (only active in `next start`) is exercised for AC7.
const PORT = 3100;

// Explicit e2e DB URL — never falls back to `.env.production.local`'s real Supabase database.
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5434/order_screen_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-only-secret-0123456789abcdef-0123",
    },
  },
});
