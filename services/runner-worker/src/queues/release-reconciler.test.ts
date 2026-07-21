import { describe, expect, it, vi } from "vitest";

import * as releaseQueueModule from "./release-queue.js";

describe("startQueuedReleaseReconciler", () => {
  it("runs reconciliation repeatedly instead of only at startup", async () => {
    vi.useFakeTimers();
    expect(releaseQueueModule).toHaveProperty("startQueuedReleaseReconciler");
    const startQueuedReleaseReconciler = (
      releaseQueueModule as typeof releaseQueueModule & {
        startQueuedReleaseReconciler(options: {
          intervalMs: number;
          reconcile(): Promise<void>;
        }): { stop(): Promise<void> };
      }
    ).startQueuedReleaseReconciler;
    const reconcile = vi.fn().mockResolvedValue(undefined);
    const reconciler = startQueuedReleaseReconciler({ intervalMs: 5_000, reconcile });

    await vi.advanceTimersByTimeAsync(10_000);
    await reconciler.stop();

    expect(reconcile).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("continues reconciling after one release fails", async () => {
    const onError = vi.fn();
    const queue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue(undefined),
      removeTerminalJob: vi.fn(),
      withReleaseLock: async <T>(releaseId: string, operation: () => Promise<T>): Promise<T> => {
        if (releaseId === "poisoned") throw new Error("poisoned release");
        return operation();
      }
    };

    await expect(releaseQueueModule.reconcileQueuedReleases({
      olderThan: new Date(),
      onError,
      queue,
      releaseRepository: {
        findReleaseById: vi.fn(async (releaseId: string) => ({
          attempt: releaseId === "healthy" ? 1 : 0,
          id: releaseId,
          status: "QUEUED"
        })),
        findQueuedBefore: vi.fn().mockResolvedValue([
          { attempt: 0, id: "poisoned" },
          { attempt: 1, id: "healthy" }
        ])
      }
    })).resolves.toEqual(["healthy"]);

    expect(queue.enqueue).toHaveBeenCalledWith("healthy", 1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "poisoned release" }));
  });

  it("does not enqueue a stale QUEUED snapshot after the release changes", async () => {
    const queue = {
      enqueue: vi.fn(),
      getJob: vi.fn(),
      removeTerminalJob: vi.fn(),
      withReleaseLock: async <T>(_releaseId: string, operation: () => Promise<T>) => operation()
    };

    await expect(releaseQueueModule.reconcileQueuedReleases({
      olderThan: new Date(),
      queue,
      releaseRepository: {
        findQueuedBefore: vi.fn().mockResolvedValue([{ attempt: 0, id: "changed" }]),
        findReleaseById: vi.fn().mockResolvedValue({ attempt: 1, id: "changed", status: "SAFE" })
      }
    })).resolves.toEqual([]);

    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
