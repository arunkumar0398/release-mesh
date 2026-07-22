import { describe, expect, it, vi } from "vitest";

import { HealthService } from "./health-service.js";

describe("HealthService", () => {
  it("reports a fresh persisted worker heartbeat", async () => {
    const now = new Date("2026-07-21T10:00:00.000Z");
    const service = new HealthService({
      clock: () => now,
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      heartbeatRepository: {
        findLatest: vi.fn().mockResolvedValue({ seenAt: new Date(now.getTime() - 10_000) })
      },
      heartbeatTtlMs: 30_000,
      redisCheck: vi.fn().mockResolvedValue(undefined)
    });

    await expect(service.getHealth()).resolves.toEqual({
      database: "up",
      redis: "up",
      status: "ok",
      worker: { fresh: true, lastSeenAt: "2026-07-21T09:59:50.000Z" }
    });
  });

  it.each([
    ["missing", null],
    ["stale", { seenAt: new Date("2026-07-21T09:59:00.000Z") }]
  ])("reports a %s worker heartbeat without degrading healthy dependencies", async (_scenario, heartbeat) => {
    const service = new HealthService({
      clock: () => new Date("2026-07-21T10:00:00.000Z"),
      databaseCheck: vi.fn().mockResolvedValue(undefined),
      heartbeatRepository: { findLatest: vi.fn().mockResolvedValue(heartbeat) },
      heartbeatTtlMs: 30_000,
      redisCheck: vi.fn().mockResolvedValue(undefined)
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      database: "up",
      redis: "up",
      status: "ok",
      worker: { fresh: false }
    });
  });

  it("reports database and Redis failures without hiding heartbeat state", async () => {
    const service = new HealthService({
      clock: () => new Date("2026-07-21T10:00:00.000Z"),
      databaseCheck: vi.fn().mockRejectedValue(new Error("database down")),
      heartbeatRepository: { findLatest: vi.fn().mockResolvedValue(null) },
      heartbeatTtlMs: 30_000,
      redisCheck: vi.fn().mockRejectedValue(new Error("redis down"))
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      database: "down",
      redis: "down",
      status: "degraded",
      worker: { fresh: false }
    });
  });
});
