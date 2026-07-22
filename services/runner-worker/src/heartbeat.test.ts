import { describe, expect, it, vi } from "vitest";

import { startWorkerHeartbeat } from "./heartbeat.js";

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
