import type { CatalogRepository, ReleaseRepository } from "@releasemesh/database";
import type { ReleaseQueuePort } from "@releasemesh/runner-worker/queue";
import { describe, expect, it, vi } from "vitest";

import {
  ReleaseOrchestrator,
  ReleaseQueueUnavailableError
} from "./release-orchestrator.js";

const assessment = {
  blastRadius: [],
  compatibleRemediation: "Keep compatibility aliases.",
  confidence: "HIGH",
  evidenceLinks: [],
  rootCause: "Mandatory checks produced the deterministic result.",
  uncertainty: "Registered dependencies only.",
  verificationSteps: ["Run every mandatory test."]
};

describe("ReleaseOrchestrator risk assessment", () => {
  it.each([
    ["AVAILABLE", "deterministic/rule-based"],
    ["AI_UNAVAILABLE", "GPT-5.6"]
  ])("rejects the invalid %s and %s pairing", async (status, source) => {
    const releaseRepository = {
      findReleaseDetailsById: vi.fn().mockResolvedValue({
        attempt: 0,
        componentVersion: {
          component: { name: "pricing" },
          version: "v2"
        },
        id: "release-123",
        riskAssessment: {
          assessment: { ...assessment, source },
          status
        },
        status: "BLOCKED",
        testRuns: [],
        transitions: []
      })
    } as unknown as ReleaseRepository;
    const orchestrator = new ReleaseOrchestrator({
      catalogRepository: {} as CatalogRepository,
      queue: {} as ReleaseQueuePort,
      releaseRepository
    });

    await expect(orchestrator.getRelease("release-123")).rejects.toThrow(
      "Persisted risk assessment status does not match its source"
    );
  });
});

describe("ReleaseOrchestrator queue failure", () => {
  it("atomically replaces risk assessment when retry enqueue fails", async () => {
    const failRelease = vi.fn().mockResolvedValue(undefined);
    const releaseRepository = {
      failRelease,
      findReleaseById: vi.fn().mockResolvedValue({ attempt: 0, id: "release-123", status: "ERROR" }),
      retryRelease: vi.fn().mockResolvedValue({ attempt: 1, id: "release-123", status: "QUEUED" })
    } as unknown as ReleaseRepository;
    const queue = {
      enqueue: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      getJob: vi.fn(),
      removeTerminalJob: vi.fn().mockResolvedValue(undefined),
      withReleaseLock: vi.fn(async (_releaseId: string, operation: () => Promise<unknown>) => operation())
    } as unknown as ReleaseQueuePort;
    const orchestrator = new ReleaseOrchestrator({
      catalogRepository: {} as CatalogRepository,
      queue,
      releaseRepository
    });

    await expect(orchestrator.retryRelease({
      correlationId: "retry-enqueue-failure",
      releaseId: "release-123"
    })).rejects.toBeInstanceOf(ReleaseQueueUnavailableError);
    expect(failRelease).toHaveBeenCalledWith(expect.objectContaining({
      assessment: expect.objectContaining({ source: "deterministic/rule-based" }),
      errorCode: "QUEUE_ENQUEUE_FAILED",
      expectedAttempt: 1,
      expectedStatus: "QUEUED",
      releaseId: "release-123"
    }));
  });
});
