import { describe, expect, it, vi } from "vitest";

import {
  cappedExponentialBackoff,
  recoverStrandedTestingReleases,
  runRecoveryTasks
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
      failRelease: vi.fn().mockResolvedValue(undefined),
      findTestingBefore: vi.fn().mockResolvedValue([
        { attempt: 0, id: "release-a" },
        { attempt: 1, id: "release-b" }
      ])
    };
    const olderThan = new Date("2026-07-21T08:00:00.000Z");

    await expect(
      recoverStrandedTestingReleases({ olderThan, releaseRepository })
    ).resolves.toEqual(["release-a", "release-b"]);

    expect(releaseRepository.failRelease).toHaveBeenCalledTimes(2);
    expect(releaseRepository.failRelease).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        assessment: expect.objectContaining({ source: "deterministic/rule-based" }),
        errorCode: "WORKER_STALLED",
        expectedAttempt: 0,
        expectedStatus: "TESTING",
        releaseId: "release-a"
      })
    );
  });

  it("does not recover a TESTING release whose BullMQ job is active", async () => {
    const releaseRepository = {
      failRelease: vi.fn().mockResolvedValue(undefined),
      findTestingBefore: vi.fn().mockResolvedValue([{ attempt: 2, id: "release-active" }]),
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
    expect(releaseRepository.failRelease).not.toHaveBeenCalled();
  });

  it("continues recovering after one TESTING release fails", async () => {
    const onError = vi.fn();
    const releaseRepository = {
      failRelease: vi.fn(async ({ releaseId }: { releaseId: string }) => {
        if (releaseId === "poisoned") throw new Error("poisoned recovery");
      }),
      findTestingBefore: vi.fn().mockResolvedValue([
        { attempt: 0, id: "poisoned" },
        { attempt: 1, id: "healthy" }
      ])
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
