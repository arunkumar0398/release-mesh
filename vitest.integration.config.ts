import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/integration/**/*.test.ts", "**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "dist", "build"],
    setupFiles: ["./tests/integration/setup.ts"]
  }
});
