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
  artifactStore,
  initialStatus = "QUEUED",
  riskAnalyzer,
  riskPlanner
}: {
  artifactStore?: ArtifactStore;
  candidateVersion?: "v2" | "v2.1";
  executor?: MandatoryCheckExecutor;
  initialStatus?: "ANALYZING" | "QUEUED" | "TESTING";
  riskAnalyzer?: ReleaseProcessorDependencies["riskAnalyzer"];
  riskPlanner?: ReleaseProcessorDependencies["riskPlanner"];
} = {}): ReleaseProcessorDependencies & { events: string[] } {
  const events: string[] = [];
  let status = initialStatus;
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
          component: { name: "pricing", ownerTeam: "pricing-platform" },
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
    riskAnalyzer: riskAnalyzer ?? {
      analyze: vi.fn(async ({ deterministicGate }) => {
        events.push(`risk:analyze:${deterministicGate}`);
        return {
          assessment: {
            blastRadius: ["checkout owned by checkout-platform"],
            compatibleRemediation: "Add compatibility aliases.",
            confidence: "HIGH" as const,
            evidenceLinks: [],
            rootCause: `Deterministic gate ${deterministicGate}.`,
            uncertainty: "deterministic/rule-based",
            verificationSteps: ["Run all mandatory tests."]
          },
          source: "deterministic/rule-based" as const,
          status: "AI_UNAVAILABLE" as const
        };
      })
    },
    riskPlanner: riskPlanner ?? {
      plan: vi.fn().mockResolvedValue([
        "contract-pricing",
        "api-pricing",
        "browser-checkout"
      ])
    },
    riskAssessmentRepository: {
      loadEvidence: vi.fn().mockResolvedValue([
        {
          contentType: "application/json",
          id: "artifact-CONTRACT_DIFF",
          jsonContent: { compatible: candidateVersion === "v2.1" },
          kind: "CONTRACT_DIFF",
          sizeBytes: 20,
          testRun: { status: candidateVersion === "v2.1" ? "PASSED" : "FAILED", testId: "contract-pricing" },
          textContent: null
        },
        {
          contentType: "text/plain",
          id: "artifact-SANITIZED_LOG",
          jsonContent: null,
          kind: "SANITIZED_LOG",
          sizeBytes: 20,
          testRun: { status: candidateVersion === "v2.1" ? "PASSED" : "FAILED", testId: "api-pricing" },
          textContent: JSON.stringify({ outcome: candidateVersion === "v2.1" ? "passed" : "failed" })
        },
        {
          contentType: "image/png",
          id: "artifact-SCREENSHOT",
          jsonContent: null,
          kind: "SCREENSHOT",
          sizeBytes: 4,
          testRun: { status: candidateVersion === "v2.1" ? "PASSED" : "FAILED", testId: "browser-checkout" },
          textContent: null
        }
      ]),
      upsert: vi.fn(async ({ status: assessmentStatus }) => {
        events.push(`risk:${assessmentStatus}`);
      })
    },
    testRunRepository: {
      complete: vi.fn(async ({ status: testStatus, testRunId }) => {
        events.push(`test:${testRunId}:${testStatus}`);
      }),
      loadAttemptSummary: vi.fn().mockResolvedValue(
        checkResults(candidateVersion).map((result) => ({
          hasArtifact: true,
          hasIncompatibleRegisteredDependency: result.hasIncompatibleRegisteredDependency,
          status: result.status,
          testId: result.testId
        }))
      ),
      prepareAttempt: vi.fn(async () => {
        events.push("attempt:prepare");
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

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).resolves.toEqual({ gate });

    expect(dependencies.mandatoryCheckExecutor.runMandatoryChecks).toHaveBeenCalledWith({
      candidateVersion,
      releaseId,
      selectedTestIds: ["contract-pricing", "api-pricing", "browser-checkout"]
    });
    expect(dependencies.riskPlanner.plan).toHaveBeenCalledWith({
      changedEndpoints: [{ method: "GET", path: "/pricing/:productId" }],
      contractDiff: expect.objectContaining({ compatible: candidateVersion === "v2.1" }),
      dependencyGraph: [{
        consumer: "checkout",
        expectedContractVersion: "v1",
        provider: "pricing",
        requiredEndpoints: ["GET /pricing/:productId"]
      }],
      trustedTests: [
        { id: "contract-pricing", mandatory: true, type: "contract" },
        { id: "api-pricing", mandatory: true, type: "api" },
        { id: "browser-checkout", mandatory: true, type: "browser" }
      ]
    });
    expect(dependencies.events).toEqual([
      "transition:QUEUED->TESTING",
      "attempt:prepare",
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
      `risk:analyze:${gate}`,
      "risk:AI_UNAVAILABLE",
      `transition:ANALYZING->${gate}`
    ]);
  });

  it("ignores an attempted GPT gate override and persists analysis before the deterministic gate", async () => {
    const dependencies = createDependencies({
      candidateVersion: "v2",
      riskAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          assessment: {
            blastRadius: [],
            compatibleRemediation: "Add aliases.",
            confidence: "HIGH",
            evidenceLinks: [],
            rootCause: "Breaking field rename.",
            uncertainty: "Registered consumers only.",
            verificationSteps: ["Run mandatory tests."]
          },
          gate: "SAFE",
          source: "GPT-5.6",
          status: "AVAILABLE"
        })
      }
    });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).resolves.toEqual({
      gate: "BLOCKED"
    });
    expect(dependencies.events.slice(-2)).toEqual([
      "risk:AVAILABLE",
      "transition:ANALYZING->BLOCKED"
    ]);
  });

  it.each([
    ["planner failure", vi.fn().mockRejectedValue(new Error("GPT planning timeout"))],
    ["untrusted planner output", vi.fn().mockResolvedValue(["arbitrary-script"])]
  ])("runs every mandatory test after %s", async (_scenario, plan) => {
    const dependencies = createDependencies({ riskPlanner: { plan } });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).resolves.toEqual({
      gate: "BLOCKED"
    });
    expect(dependencies.mandatoryCheckExecutor.runMandatoryChecks).toHaveBeenCalledWith({
      candidateVersion: "v2",
      releaseId,
      selectedTestIds: ["contract-pricing", "api-pricing", "browser-checkout"]
    });
  });

  it("does not publish a terminal gate before the risk fallback is durable", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.riskAssessmentRepository.upsert).mockRejectedValue(
      new Error("risk persistence unavailable")
    );

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).rejects.toMatchObject({
      code: "CHECK_EXECUTION_FAILED"
    });
    expect(dependencies.events).not.toContain("transition:ANALYZING->BLOCKED");
  });

  it.each([
    ["Pricing", new Error("Pricing unavailable"), "CHECK_EXECUTION_FAILED"],
    ["timeout", new Error("Pricing check timed out"), "CHECK_EXECUTION_FAILED"],
    ["Playwright", new Error("browser crashed"), "CHECK_EXECUTION_FAILED"]
  ])("returns %s failures to BullMQ for retry", async (_scenario, failure, expectedErrorCode) => {
    const dependencies = createDependencies({
      executor: { runMandatoryChecks: vi.fn().mockRejectedValue(failure) }
    });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).rejects.toMatchObject({
      code: expectedErrorCode,
      name: "ReleaseProcessingError"
    });
    expect(dependencies.events).toEqual(["transition:QUEUED->TESTING", "attempt:prepare"]);
  });

  it("returns artifact-storage failure to BullMQ for retry", async () => {
    const artifactStore: ArtifactStore = {
      get: vi.fn(),
      put: vi.fn().mockRejectedValue(new Error("Postgres artifact storage failed"))
    };
    const dependencies = createDependencies({ artifactStore });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).rejects.toMatchObject({
      code: "ARTIFACT_STORAGE_FAILED",
      name: "ReleaseProcessingError"
    });

    expect(dependencies.testRunRepository.complete).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ERROR", testRunId: "run-contract-pricing" })
    );
    expect(dependencies.testRunRepository.start).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 0 })
    );
    expect(dependencies.events).not.toContain("transition:TESTING->ERROR");
  });

  it("resumes the same release while BullMQ retries a TESTING job", async () => {
    const dependencies = createDependencies({ initialStatus: "TESTING" });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).resolves.toEqual({
      gate: "BLOCKED"
    });

    expect(dependencies.events[0]).toBe("attempt:prepare");
    expect(dependencies.events[1]).toBe("test:contract-pricing:RUNNING");
    expect(dependencies.events).not.toContain("transition:QUEUED->TESTING");
  });

  it("recomputes the deterministic gate when retrying from ANALYZING", async () => {
    const dependencies = createDependencies({ candidateVersion: "v2.1", initialStatus: "ANALYZING" });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).resolves.toEqual({ gate: "SAFE" });

    expect(dependencies.events).toContain("transition:ANALYZING->SAFE");
    expect(dependencies.events).not.toContain("transition:TESTING->ANALYZING");
    expect(dependencies.events).not.toContain("attempt:prepare");
    expect(dependencies.mandatoryCheckExecutor.runMandatoryChecks).not.toHaveBeenCalled();
    expect(dependencies.testRunRepository.loadAttemptSummary).toHaveBeenCalledWith({
      attempt: 0,
      releaseId
    });
  });

  it("uses ERROR when mandatory evidence is missing or duplicated", async () => {
    const incomplete = checkResults("v2.1").slice(0, 2);
    const dependencies = createDependencies({
      executor: { runMandatoryChecks: vi.fn().mockResolvedValue(incomplete) }
    });

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 0)).resolves.toEqual({ gate: "ERROR" });
    expect(dependencies.events).toContain("transition:ANALYZING->ERROR");
  });

  it("rejects a stale queue job before running checks", async () => {
    const dependencies = createDependencies();

    await expect(new ReleaseProcessor(dependencies).process(releaseId, 1))
      .rejects.toThrow("Release attempt does not match queue job");

    expect(dependencies.mandatoryCheckExecutor.runMandatoryChecks).not.toHaveBeenCalled();
    expect(dependencies.events).toEqual([]);
  });
});
