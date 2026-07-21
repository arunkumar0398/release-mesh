import { describe, expect, it, vi } from "vitest";

import {
  cappedExponentialBackoff,
  recoverStrandedTestingReleases,
  startWorkerHeartbeat
} from "./recovery.js";

describe("cappedExponentialBackoff", () => {
  it("backs off exponentially and caps retry delay", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(cappedExponentialBackoff)).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      16_000,
      30_000,
      30_000
    ]);
  });
});

describe("recoverStrandedTestingReleases", () => {
  it("transactionally moves every stranded TESTING release to ERROR", async () => {
    const releaseRepository = {
      findTestingBefore: vi.fn().mockResolvedValue([{ id: "release-a" }, { id: "release-b" }]),
      transitionRelease: vi.fn().mockResolvedValue(undefined)
    };
    const olderThan = new Date("2026-07-21T08:00:00.000Z");

    await expect(
      recoverStrandedTestingReleases({ olderThan, releaseRepository })
    ).resolves.toEqual(["release-a", "release-b"]);

    expect(releaseRepository.transitionRelease).toHaveBeenCalledTimes(2);
    expect(releaseRepository.transitionRelease).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        errorCode: "WORKER_STALLED",
        expectedStatus: "TESTING",
        nextStatus: "ERROR",
        releaseId: "release-a"
      })
    );
  });
});

describe("startWorkerHeartbeat", () => {
  it("persists immediately and then at the configured interval", async () => {
    vi.useFakeTimers();
    const heartbeatRepository = { record: vi.fn().mockResolvedValue(undefined) };

    const heartbeat = startWorkerHeartbeat({
      heartbeatRepository,
      intervalMs: 5_000,
      workerId: "runner-1"
    });
    await heartbeat.ready;
    await vi.advanceTimersByTimeAsync(10_000);
    await heartbeat.stop();

    expect(heartbeatRepository.record).toHaveBeenCalledTimes(3);
    expect(heartbeatRepository.record).toHaveBeenCalledWith("runner-1", expect.any(Date));
    vi.useRealTimers();
  });
});
