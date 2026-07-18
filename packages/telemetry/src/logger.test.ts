import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("writes structured release correlation fields", () => {
    const write = vi.fn();
    const logger = createLogger(write);

    logger.info("release queued", {
      releaseId: "release-123",
      testRunId: "test-run-456",
      status: "QUEUED",
      attempt: 1,
      durationMs: 20,
      correlationId: "correlation-789"
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        message: "release queued",
        releaseId: "release-123",
        testRunId: "test-run-456",
        status: "QUEUED",
        attempt: 1,
        durationMs: 20,
        correlationId: "correlation-789"
      })
    );
  });
});
