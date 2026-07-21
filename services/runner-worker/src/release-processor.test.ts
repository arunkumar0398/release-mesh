import type { ArtifactInput, ArtifactStore } from "@releasemesh/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  ReleaseProcessor,
  type MandatoryCheckExecutor,
  type ReleaseProcessorDependencies,
  type TrustedCheckResult
} from "./release-processor.js";

const releaseId = "release-processor-test";

function checkResults(candidateVersion: "v2" | "v2.1"): TrustedCheckResult[] {
  const passed = candidateVersion === "v2.1";
  return [
    {
      artifact: {
        content: JSON.stringify({ compatible: passed }),
        contentType: "application/json",
        kind: "CONTRACT_DIFF"
      },
      hasIncompatibleRegisteredDependency: !passed,
      status: passed ? "PASSED" : "FAILED",
      testId: "contract-pricing"
    },
    {
      artifact: {
        content: JSON.stringify({ outcome: passed ? "passed" : "failed" }),
        contentType: "text/plain",
        kind: "SANITIZED_LOG"
      },
      hasIncompatibleRegisteredDependency: false,
      status: passed ? "PASSED" : "FAILED",
      testId: "api-pricing"
    },
    {
      artifact: {
        content: new Uint8Array([137, 80, 78, 71]),
        contentType: "image/png",
        kind: "SCREENSHOT"
      },
      hasIncompatibleRegisteredDependency: false,
      status: passed ? "PASSED" : "FAILED",
      testId: "browser-checkout"
    }
  ];
}

function createDependencies({
  candidateVersion = "v2",
  executor = { runMandatoryChecks: vi.fn().mockResolvedValue(checkResults(candidateVersion)) },
  artifactStore
}: {
  artifactStore?: ArtifactStore;
  candidateVersion?: "v2" | "v2.1";
  executor?: MandatoryCheckExecutor;
} = {}): ReleaseProcessorDependencies & { events: string[] } {
  const events: string[] = [];
  let status = "QUEUED";
  const store: ArtifactStore = artifactStore ?? {
    get: vi.fn(),
    put: vi.fn(async (input: ArtifactInput) => {
      events.push(`artifact:${input.kind}`);
      return {
        contentType: input.contentType,
        id: `artifact-${input.kind}`,
        kind: input.kind,
        releaseId: input.releaseId,
        sizeBytes: typeof input.content === "string" ? input.content.length : input.content.byteLength,
        testRunId: input.testRunId
      };
    })
  };

  return {
    artifactStore: store,
    events,
    mandatoryCheckExecutor: executor,
    releaseRepository: {
      findReleaseById: vi.fn(async () => ({
        attempt: 0,
        componentVersion: {
          component: { name: "pricing" },
          version: candidateVersion
        },
        id: releaseId,
        status
      })),
      transitionRelease: vi.fn(async ({ expectedStatus, nextStatus }) => {
        expect(status).toBe(expectedStatus);
        events.push(`transition:${expectedStatus}->${nextStatus}`);
        status = nextStatus;
        return { id: releaseId, status };
      })
    },
    testRunRepository: {
      complete: vi.fn(async ({ status: testStatus, testRunId }) => {
        events.push(`test:${testRunId}:${testStatus}`);
      }),
      start: vi.fn(async ({ testId }) => {
        events.push(`test:${testId}:RUNNING`);
        return { id: `run-${testId}` };
      })
    }
  };
}

describe("ReleaseProcessor", () => {
  it.each([
    ["v2", "BLOCKED"],
    ["v2.1", "SAFE"]
  ] as const)("persists %s evidence before the deterministic %s gate", async (candidateVersion, gate) => {
    const dependencies = createDependencies({ candidateVersion });

    await expect(new ReleaseProcessor(dependencies).process(releaseId)).resolves.toEqual({ gate });

    expect(dependencies.mandatoryCheckExecutor.runMandatoryChecks).toHaveBeenCalledWith({
      candidateVersion,
      releaseId
    });
    expect(dependencies.events).toEqual([
      "transition:QUEUED->TESTING",
      "test:contract-pricing:RUNNING",
      "artifact:CONTRACT_DIFF",
      `test:run-contract-pricing:${candidateVersion === "v2" ? "FAILED" : "PASSED"}`,
      "test:api-pricing:RUNNING",
      "artifact:SANITIZED_LOG",
      `test:run-api-pricing:${candidateVersion === "v2" ? "FAILED" : "PASSED"}`,
      "test:browser-checkout:RUNNING",
      "artifact:SCREENSHOT",
      `test:run-browser-checkout:${candidateVersion === "v2" ? "FAILED" : "PASSED"}`,
      "transition:TESTING->ANALYZING",
      `transition:ANALYZING->${gate}`
    ]);
  });

  it.each([
    ["Pricing", new Error("Pricing unavailable"), "CHECK_EXECUTION_FAILED"],
    ["timeout", new Error("Pricing check timed out"), "CHECK_EXECUTION_FAILED"],
    ["Playwright", new Error("browser crashed"), "CHECK_EXECUTION_FAILED"]
  ])("persists %s failures as ERROR", async (_scenario, failure, expectedErrorCode) => {
    const dependencies = createDependencies({
      executor: { runMandatoryChecks: vi.fn().mockRejectedValue(failure) }
    });

    await expect(new ReleaseProcessor(dependencies).process(releaseId)).resolves.toEqual({ gate: "ERROR" });

    expect(dependencies.releaseRepository.transitionRelease).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorCode: expectedErrorCode,
        expectedStatus: "TESTING",
        nextStatus: "ERROR",
        releaseId
      })
    );
  });

  it("persists artifact-storage failure as ERROR", async () => {
    const artifactStore: ArtifactStore = {
      get: vi.fn(),
      put: vi.fn().mockRejectedValue(new Error("Postgres artifact storage failed"))
    };
    const dependencies = createDependencies({ artifactStore });

    await expect(new ReleaseProcessor(dependencies).process(releaseId)).resolves.toEqual({ gate: "ERROR" });

    expect(dependencies.testRunRepository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ERROR", testRunId: "run-contract-pricing" })
    );
    expect(dependencies.releaseRepository.transitionRelease).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorCode: "ARTIFACT_STORAGE_FAILED",
        expectedStatus: "TESTING",
        nextStatus: "ERROR"
      })
    );
  });

  it("uses ERROR when mandatory evidence is missing or duplicated", async () => {
    const incomplete = checkResults("v2.1").slice(0, 2);
    const dependencies = createDependencies({
      executor: { runMandatoryChecks: vi.fn().mockResolvedValue(incomplete) }
    });

    await expect(new ReleaseProcessor(dependencies).process(releaseId)).resolves.toEqual({ gate: "ERROR" });
    expect(dependencies.events).toContain("transition:ANALYZING->ERROR");
  });
});
