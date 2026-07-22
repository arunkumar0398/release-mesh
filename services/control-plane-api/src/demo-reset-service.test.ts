import { describe, expect, it, vi } from "vitest";

import { DemoResetBusyError, DemoResetService } from "./demo-reset-service.js";

describe("DemoResetService", () => {
  it("pauses and clears inactive release jobs before resetting the database", async () => {
    const calls: string[] = [];
    const service = new DemoResetService({
      queue: {
        clean: vi.fn(async (_grace, _limit, state) => { calls.push(`clean:${state}`); return []; }),
        drain: vi.fn(async () => { calls.push("drain"); }),
        getActiveCount: vi.fn(async () => { calls.push("active"); return 0; }),
        pause: vi.fn(async () => { calls.push("pause"); }),
        resume: vi.fn(async () => { calls.push("resume"); })
      },
      resetDatabase: vi.fn(async () => { calls.push("database"); })
    });

    await service.reset();

    expect(calls).toEqual([
      "pause",
      "active",
      "drain",
      "clean:completed",
      "clean:failed",
      "database",
      "resume"
    ]);
  });

  it("refuses to reset while a release job is active and resumes the queue", async () => {
    const resetDatabase = vi.fn();
    const resume = vi.fn();
    const service = new DemoResetService({
      queue: {
        clean: vi.fn(),
        drain: vi.fn(),
        getActiveCount: vi.fn().mockResolvedValue(1),
        pause: vi.fn().mockResolvedValue(undefined),
        resume
      },
      resetDatabase
    });

    await expect(service.reset()).rejects.toBeInstanceOf(DemoResetBusyError);
    expect(resetDatabase).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledOnce();
  });
});
