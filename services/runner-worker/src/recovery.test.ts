import { describe, expect, it, vi } from "vitest";

import {
  cappedExponentialBackoff,
  recoverStrandedTestingReleases,
  runRecoveryTasks,
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

  it("does not recover a TESTING release whose BullMQ job is active", async () => {
    const releaseRepository = {
      findTestingBefore: vi.fn().mockResolvedValue([{ attempt: 2, id: "release-active" }]),
      transitionRelease: vi.fn().mockResolvedValue(undefined)
    };
    const queue = {
      getJob: vi.fn().mockResolvedValue({
        data: { attempt: 2, releaseId: "release-active" },
        getState: vi.fn().mockResolvedValue("active")
      })
    };

    await expect(
      recoverStrandedTestingReleases({
        olderThan: new Date("2026-07-21T08:00:00.000Z"),
        queue,
        releaseRepository
      })
    ).resolves.toEqual([]);
    expect(releaseRepository.transitionRelease).not.toHaveBeenCalled();
  });

  it("continues recovering after one TESTING release fails", async () => {
    const onError = vi.fn();
    const releaseRepository = {
      findTestingBefore: vi.fn().mockResolvedValue([
        { attempt: 0, id: "poisoned" },
        { attempt: 1, id: "healthy" }
      ]),
      transitionRelease: vi.fn(async ({ releaseId }: { releaseId: string }) => {
        if (releaseId === "poisoned") throw new Error("poisoned recovery");
      })
    };

    await expect(recoverStrandedTestingReleases({
      olderThan: new Date(),
      onError,
      releaseRepository
    })).resolves.toEqual(["healthy"]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "poisoned recovery" }));
  });
});

describe("runRecoveryTasks", () => {
  it("runs every recovery phase even when one fails", async () => {
    const second = vi.fn().mockResolvedValue(undefined);

    await expect(runRecoveryTasks([
      vi.fn().mockRejectedValue(new Error("queued query failed")),
      second
    ])).rejects.toThrow("Recovery sweep failed");

    expect(second).toHaveBeenCalledOnce();
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

  it("serializes writes and reports rejected heartbeats", async () => {
    vi.useFakeTimers();
    let releaseWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const heartbeatRepository = {
      record: vi.fn()
        .mockReturnValueOnce(firstWrite)
        .mockRejectedValueOnce(new Error("database unavailable"))
    };
    const onError = vi.fn();

    const heartbeat = startWorkerHeartbeat({
      heartbeatRepository,
      intervalMs: 5_000,
      onError,
      workerId: "runner-1"
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeatRepository.record).toHaveBeenCalledTimes(1);

    releaseWrite();
    await heartbeat.ready;
    await vi.advanceTimersByTimeAsync(5_000);
    await heartbeat.stop();

    expect(heartbeatRepository.record).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "database unavailable" }));
    vi.useRealTimers();
  });

});
