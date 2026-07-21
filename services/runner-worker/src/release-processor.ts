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
    expectedAttempt?: number;
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
  loadAttemptSummary(input: { attempt: number; releaseId: string }): Promise<Array<{
    hasArtifact: boolean;
    hasIncompatibleRegisteredDependency: boolean;
    status: MandatoryTestStatus;
    testId: string;
  }>>;
  prepareAttempt(input: { attempt: number; releaseId: string }): Promise<void>;
  start(input: {
    attempt: number;
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

export class ReleaseProcessingError extends Error {
  public constructor(
    public readonly code: "ARTIFACT_STORAGE_FAILED" | "CHECK_EXECUTION_FAILED",
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : "Release processing failed", { cause });
    this.name = "ReleaseProcessingError";
  }
}

export class ReleaseProcessor {
  public constructor(private readonly dependencies: ReleaseProcessorDependencies) {}

  public async process(
    releaseId: string,
    expectedAttempt: number
  ): Promise<{ gate: DeterministicReleaseGate }> {
    const release = await this.dependencies.releaseRepository.findReleaseById(releaseId);
    if (!release) throw new Error(`Release not found: ${releaseId}`);
    if (release.attempt !== expectedAttempt) {
      throw new Error(`Release attempt does not match queue job: ${releaseId}`);
    }
    if (!(["QUEUED", "TESTING", "ANALYZING"] as string[]).includes(release.status)) {
      throw new Error(`Release is not QUEUED, TESTING, or ANALYZING: ${releaseId}`);
    }
    if (
      release.componentVersion.component.name !== "pricing" ||
      (release.componentVersion.version !== "v2" && release.componentVersion.version !== "v2.1")
    ) {
      throw new Error("Release does not reference a bundled Pricing candidate");
    }

    const correlationId = `worker:${releaseId}:attempt:${release.attempt}`;
    if (release.status === "QUEUED") {
      await this.dependencies.releaseRepository.transitionRelease({
        correlationId,
        expectedAttempt: release.attempt,
        expectedStatus: "QUEUED",
        nextStatus: "TESTING",
        releaseId
      });
    }

    try {
      const results = release.status === "ANALYZING"
        ? await this.dependencies.testRunRepository.loadAttemptSummary({
            attempt: release.attempt,
            releaseId
          })
        : await this.runAndPersistChecks(releaseId, release.attempt, release.componentVersion.version);

      if (release.status !== "ANALYZING") {
        await this.dependencies.releaseRepository.transitionRelease({
          correlationId,
          expectedAttempt: release.attempt,
          expectedStatus: "TESTING",
          nextStatus: "ANALYZING",
          releaseId
        });
      }
      const expectedMandatoryTestIds = Object.keys(trustedTestRegistry) as TrustedTestId[];
      const gate = decideReleaseGate({
        evidenceComplete: results.every((result) => result.hasArtifact),
        expectedMandatoryTestIds,
        hasIncompatibleRegisteredDependency: results.some(
          (result) => result.hasIncompatibleRegisteredDependency
        ),
        mandatoryTests: results.map(({ status, testId }) => ({ id: testId, status })),
        requiredChecksCompleted: true
      });

      await this.dependencies.releaseRepository.transitionRelease({
        correlationId,
        expectedAttempt: release.attempt,
        expectedStatus: "ANALYZING",
        nextStatus: gate,
        releaseId
      });
      return { gate };
    } catch (error) {
      const errorCode = error instanceof ArtifactStorageError
        ? "ARTIFACT_STORAGE_FAILED"
        : "CHECK_EXECUTION_FAILED";
      throw new ReleaseProcessingError(errorCode, error);
    }
  }

  private async runAndPersistChecks(
    releaseId: string,
    attempt: number,
    candidateVersion: PricingContractVersion
  ) {
    await this.dependencies.testRunRepository.prepareAttempt({ attempt, releaseId });
    const results = await this.dependencies.mandatoryCheckExecutor.runMandatoryChecks({
      candidateVersion,
      releaseId
    });
    await this.persistEvidence(releaseId, attempt, results);
    return results.map((result) => ({
      hasArtifact: result.artifact !== undefined,
      hasIncompatibleRegisteredDependency: result.hasIncompatibleRegisteredDependency,
      status: result.status,
      testId: result.testId
    }));
  }

  private async persistEvidence(
    releaseId: string,
    attempt: number,
    results: TrustedCheckResult[]
  ): Promise<void> {
    for (const result of results) {
      const testRun = await this.dependencies.testRunRepository.start({
        attempt,
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
