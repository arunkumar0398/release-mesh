import { describe, expect, it } from "vitest";

import { loadEnvironment } from "./env.js";

describe("loadEnvironment", () => {
  it("accepts the required infrastructure URLs", () => {
    expect(
      loadEnvironment({
        DATABASE_URL: "postgresql://localhost/releasemesh",
        REDIS_URL: "redis://localhost:6379"
      })
    ).toMatchObject({
      databaseUrl: "postgresql://localhost/releasemesh",
      redisUrl: "redis://localhost:6379",
      openAiModel: "gpt-5.6"
    });
  });

  it("rejects a missing database URL", () => {
    expect(() => loadEnvironment({ REDIS_URL: "redis://localhost:6379" })).toThrow(
      "DATABASE_URL is required"
    );
  });
});
