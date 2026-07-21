import {
  decideReleaseGate,
  type ArtifactStore,
  type DeterministicReleaseGate,
  type MandatoryTestStatus,
  type ReleaseStatus
} from "@releasemesh/contracts";

import type { PricingContractVersion } from "@releasemesh/contracts";
import { trustedTestRegistry, type TrustedTestId } from "./test-registry.js";

type CheckArtifact =
  | { content: string; contentType: "application/json"; kind: "CONTRACT_DIFF" }
  | { content: string; contentType: "text/plain"; kind: "SANITIZED_LOG" }
  | { content: Uint8Array; contentType: "image/png"; kind: "SCREENSHOT" };

export interface TrustedCheckResult {
  artifact: CheckArtifact;
  hasIncompatibleRegisteredDependency: boolean;
  status: MandatoryTestStatus;
  testId: TrustedTestId;
}

export interface MandatoryCheckExecutor {
  runMandatoryChecks(input: {
    candidateVersion: PricingContractVersion;
    releaseId: string;
  }): Promise<TrustedCheckResult[]>;
}

interface ProcessorRelease {
  attempt: number;
  componentVersion: {
    component: { name: string };
    version: string;
  };
  id: string;
  status: string;
}

interface ProcessorReleaseRepository {
  findReleaseById(releaseId: string): Promise<ProcessorRelease | null>;
  transitionRelease(input: {
    correlationId: string;
    errorCode?: string;
    expectedStatus: ReleaseStatus;
    nextStatus: ReleaseStatus;
    reason?: string;
    releaseId: string;
  }): Promise<unknown>;
}

interface TestRunRepositoryPort {
  complete(input: {
    status: MandatoryTestStatus | "ERROR";
    testRunId: string;
  }): Promise<void>;
  start(input: {
    releaseId: string;
    testId: TrustedTestId;
  }): Promise<{ id: string }>;
}

export interface ReleaseProcessorDependencies {
  artifactStore: ArtifactStore;
  mandatoryCheckExecutor: MandatoryCheckExecutor;
  releaseRepository: ProcessorReleaseRepository;
  testRunRepository: TestRunRepositoryPort;
}

class ArtifactStorageError extends Error {
  public constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Artifact storage failed", { cause });
    this.name = "ArtifactStorageError";
  }
}

export class ReleaseProcessor {
  public constructor(private readonly dependencies: ReleaseProcessorDependencies) {}

  public async process(releaseId: string): Promise<{ gate: DeterministicReleaseGate }> {
    const release = await this.dependencies.releaseRepository.findReleaseById(releaseId);
    if (!release) throw new Error(`Release not found: ${releaseId}`);
    if (release.status !== "QUEUED") throw new Error(`Release is not QUEUED: ${releaseId}`);
    if (
      release.componentVersion.component.name !== "pricing" ||
      (release.componentVersion.version !== "v2" && release.componentVersion.version !== "v2.1")
    ) {
      throw new Error("Release does not reference a bundled Pricing candidate");
    }

    const correlationId = `worker:${releaseId}:attempt:${release.attempt}`;
    await this.dependencies.releaseRepository.transitionRelease({
      correlationId,
      expectedStatus: "QUEUED",
      nextStatus: "TESTING",
      releaseId
    });

    let currentStatus: "TESTING" | "ANALYZING" = "TESTING";
    try {
      const results = await this.dependencies.mandatoryCheckExecutor.runMandatoryChecks({
        candidateVersion: release.componentVersion.version,
        releaseId
      });
      await this.persistEvidence(releaseId, results);

      await this.dependencies.releaseRepository.transitionRelease({
        correlationId,
        expectedStatus: "TESTING",
        nextStatus: "ANALYZING",
        releaseId
      });
      currentStatus = "ANALYZING";

      const expectedMandatoryTestIds = Object.keys(trustedTestRegistry) as TrustedTestId[];
      const gate = decideReleaseGate({
        evidenceComplete: results.every((result) => result.artifact !== undefined),
        expectedMandatoryTestIds,
        hasIncompatibleRegisteredDependency: results.some(
          (result) => result.hasIncompatibleRegisteredDependency
        ),
        mandatoryTests: results.map(({ status, testId }) => ({ id: testId, status })),
        requiredChecksCompleted: true
      });

      await this.dependencies.releaseRepository.transitionRelease({
        correlationId,
        expectedStatus: "ANALYZING",
        nextStatus: gate,
        releaseId
      });
      return { gate };
    } catch (error) {
      const errorCode = error instanceof ArtifactStorageError
        ? "ARTIFACT_STORAGE_FAILED"
        : "CHECK_EXECUTION_FAILED";
      await this.dependencies.releaseRepository.transitionRelease({
        correlationId,
        errorCode,
        expectedStatus: currentStatus,
        nextStatus: "ERROR",
        reason: error instanceof Error ? error.message : "Release processing failed",
        releaseId
      });
      return { gate: "ERROR" };
    }
  }

  private async persistEvidence(releaseId: string, results: TrustedCheckResult[]): Promise<void> {
    for (const result of results) {
      const testRun = await this.dependencies.testRunRepository.start({
        releaseId,
        testId: result.testId
      });

      try {
        await this.dependencies.artifactStore.put({
          ...result.artifact,
          releaseId,
          testRunId: testRun.id
        });
      } catch (error) {
        await this.dependencies.testRunRepository.complete({
          status: "ERROR",
          testRunId: testRun.id
        });
        throw new ArtifactStorageError(error);
      }

      await this.dependencies.testRunRepository.complete({
        status: result.status,
        testRunId: testRun.id
      });
    }
  }
}
