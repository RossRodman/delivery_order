import { defineConfig, devices } from "@playwright/test";

// Skeleton (B0). F10 fills in globalSetup (db reset + seed) and the specs.
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
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
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        "postgres://postgres:postgres@localhost:5434/order_screen_e2e",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-only-secret-0123456789abcdef-0123",
    },
  },
});
