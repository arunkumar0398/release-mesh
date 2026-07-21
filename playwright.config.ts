import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "test-results",
  preserveOutput: "always",
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure"
  }
});
