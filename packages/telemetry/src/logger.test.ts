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

  it("preserves reserved fields when context contains conflicting values", () => {
    const write = vi.fn();
    const logger = createLogger(write);

    logger.info("release queued", {
      level: "error",
      message: "overridden message",
      timestamp: "2000-01-01T00:00:00.000Z"
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        message: "release queued",
        timestamp: expect.any(String)
      })
    );
    expect(write.mock.calls[0][0].timestamp).not.toBe("2000-01-01T00:00:00.000Z");
  });
});
