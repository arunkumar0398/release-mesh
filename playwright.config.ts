import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "test-results",
  preserveOutput: "always",
  testDir: "./tests/e2e",
  timeout: 30_000,
  webServer: {
    command: "corepack pnpm --filter @releasemesh/checkout dev --port 4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:4173"
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4173",
    trace: "retain-on-failure"
  }
});
