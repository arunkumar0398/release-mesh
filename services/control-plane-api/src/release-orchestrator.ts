import type { ReleaseStatus } from "@releasemesh/contracts";
import {
  CatalogRepository,
  ReleaseRepository
} from "@releasemesh/database";
import type { ReleaseQueuePort } from "@releasemesh/runner-worker/queue";

import type {
  BundledPricingCandidate,
  ReleaseArtifactView,
  ReleaseDetailsView,
  ReleaseRiskAssessmentView,
  ReleaseView,
  SubmitReleaseInput
} from "./routes/releases.js";

export interface ReleaseOrchestratorDependencies {
  catalogRepository: CatalogRepository;
  queue: ReleaseQueuePort;
  releaseRepository: ReleaseRepository;
}

export class ReleaseQueueUnavailableError extends Error {
  public constructor(cause: unknown) {
    super("Release queue unavailable", { cause });
    this.name = "ReleaseQueueUnavailableError";
  }
}

export class ReleaseNotFoundError extends Error {
  public constructor(releaseId: string) {
    super("Release not found", { cause: new Error(`Release not found: ${releaseId}`) });
    this.name = "ReleaseNotFoundError";
  }
}

export class ReleaseRetryConflictError extends Error {
  public constructor() {
    super("Only ERROR releases can be retried");
    this.name = "ReleaseRetryConflictError";
  }
}

export class ReleaseOrchestrator {
  public constructor(private readonly dependencies: ReleaseOrchestratorDependencies) {}

  public async listArtifacts(releaseId: string): Promise<ReleaseArtifactView[]> {
    const artifacts = await this.dependencies.releaseRepository.listArtifacts(releaseId);
    return artifacts.map((artifact) => ({
      attempt: artifact.testRun?.attempt ?? null,
      binaryContent: artifact.binaryContent
        ? Buffer.from(artifact.binaryContent).toString("base64")
        : null,
      contentType: artifact.contentType,
      createdAt: artifact.createdAt.toISOString(),
      id: artifact.id,
      jsonContent: artifact.jsonContent,
      kind: artifact.kind,
      sizeBytes: artifact.sizeBytes,
      testRunId: artifact.testRunId,
      textContent: artifact.textContent
    }));
  }

  public async getRelease(releaseId: string): Promise<ReleaseDetailsView | null> {
    const release = await this.dependencies.releaseRepository.findReleaseDetailsById(releaseId);
    if (!release) return null;

    return {
      ...toReleaseView(release),
      riskAssessment: release.riskAssessment === null
        ? null
        : toRiskAssessmentView(release.riskAssessment),
      testRuns: release.testRuns.map((testRun) => ({
        attempt: testRun.attempt,
        endedAt: testRun.endedAt?.toISOString() ?? null,
        id: testRun.id,
        startedAt: testRun.startedAt?.toISOString() ?? null,
        status: testRun.status,
        testId: testRun.testId
      })),
      transitions: release.transitions.map((transition) => ({
        attempt: transition.attempt,
        createdAt: transition.createdAt.toISOString(),
        errorCode: transition.errorCode,
        fromStatus: transition.fromStatus as ReleaseStatus | null,
        id: transition.id,
        reason: transition.reason,
        toStatus: transition.toStatus as ReleaseStatus
      }))
    };
  }

  public async submitRelease(
    input: SubmitReleaseInput
  ): Promise<{ created: boolean; release: ReleaseView }> {
    const componentVersion = await this.dependencies.catalogRepository.findComponentVersion(
      "pricing",
      input.candidateVersion
    );
    if (!componentVersion || componentVersion.component.name !== "pricing") {
      throw new Error(`Bundled Pricing candidate not found: ${input.candidateVersion}`);
    }

    const result = await this.dependencies.releaseRepository.createQueuedRelease({
      componentVersionId: componentVersion.id,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey
    });
    if (!result.created) {
      const existing = await this.dependencies.releaseRepository.findReleaseById(result.release.id);
      if (!existing) throw new Error(`Release not found: ${result.release.id}`);
      return { created: false, release: toReleaseView(existing) };
    }

    try {
      await this.dependencies.queue.enqueue(result.release.id, result.release.attempt);
    } catch (error) {
      await this.dependencies.releaseRepository.failRelease({
        assessment: buildQueueFailureAssessment(),
        correlationId: input.correlationId,
        errorCode: "QUEUE_ENQUEUE_FAILED",
        expectedAttempt: result.release.attempt,
        expectedStatus: "QUEUED",
        releaseId: result.release.id
      });
      throw new ReleaseQueueUnavailableError(error);
    }

    return {
      created: true,
      release: {
        attempt: result.release.attempt,
        candidateVersion: input.candidateVersion,
        id: result.release.id,
        status: result.release.status as ReleaseStatus
      }
    };
  }

  public async retryRelease({
    correlationId,
    releaseId
  }: {
    correlationId: string;
    releaseId: string;
  }): Promise<ReleaseView> {
    return this.dependencies.queue.withReleaseLock(releaseId, async () => {
      const current = await this.dependencies.releaseRepository.findReleaseById(releaseId);
      if (!current) throw new ReleaseNotFoundError(releaseId);
      if (current.status !== "ERROR") throw new ReleaseRetryConflictError();
      await this.dependencies.queue.removeTerminalJob(releaseId, current.attempt);
      const release = await this.dependencies.releaseRepository.retryRelease(releaseId, correlationId);

      try {
        await this.dependencies.queue.enqueue(releaseId, release.attempt);
      } catch (error) {
        await this.dependencies.releaseRepository.failRelease({
          assessment: buildQueueFailureAssessment(),
          correlationId,
          errorCode: "QUEUE_ENQUEUE_FAILED",
          expectedAttempt: release.attempt,
          expectedStatus: "QUEUED",
          releaseId
        });
        throw new ReleaseQueueUnavailableError(error);
      }

      const hydrated = await this.dependencies.releaseRepository.findReleaseById(release.id);
      if (!hydrated) throw new Error(`Release not found: ${release.id}`);
      return toReleaseView(hydrated);
    });
  }
}

function buildQueueFailureAssessment(): Record<string, unknown> {
  return {
    blastRadius: [],
    compatibleRemediation: "Restore Redis/BullMQ availability, then retry every mandatory trusted check.",
    confidence: "HIGH",
    evidenceLinks: [],
    rootCause: "Release entered deterministic ERROR after QUEUE_ENQUEUE_FAILED.",
    source: "deterministic/rule-based",
    uncertainty: "No trusted checks ran, so no release-safety inference is available.",
    verificationSteps: [
      "Restore Redis/BullMQ availability.",
      "Retry the release and rerun every mandatory trusted check."
    ]
  };
}

function toRiskAssessmentView(riskAssessment: {
  assessment: unknown;
  status: string;
}): ReleaseRiskAssessmentView {
  if (riskAssessment.status !== "AVAILABLE" && riskAssessment.status !== "AI_UNAVAILABLE") {
    throw new Error("Persisted risk assessment has an invalid status");
  }
  if (
    typeof riskAssessment.assessment !== "object"
    || riskAssessment.assessment === null
    || Array.isArray(riskAssessment.assessment)
  ) {
    throw new Error("Persisted risk assessment has invalid content");
  }
  const assessment = riskAssessment.assessment as Record<string, unknown>;
  const source = assessment.source;
  const confidence = assessment.confidence;
  if (source !== "GPT-5.6" && source !== "deterministic/rule-based") {
    throw new Error("Persisted risk assessment has an invalid source");
  }
  if (
    (riskAssessment.status === "AVAILABLE" && source !== "GPT-5.6")
    || (riskAssessment.status === "AI_UNAVAILABLE" && source !== "deterministic/rule-based")
  ) {
    throw new Error("Persisted risk assessment status does not match its source");
  }
  if (confidence !== "HIGH" && confidence !== "LOW" && confidence !== "MEDIUM") {
    throw new Error("Persisted risk assessment has invalid confidence");
  }

  return {
    assessment: {
      blastRadius: readStringArray(assessment.blastRadius),
      compatibleRemediation: readString(assessment.compatibleRemediation),
      confidence,
      evidenceLinks: readEvidenceLinks(assessment.evidenceLinks),
      rootCause: readString(assessment.rootCause),
      source,
      uncertainty: readString(assessment.uncertainty),
      verificationSteps: readStringArray(assessment.verificationSteps)
    },
    status: riskAssessment.status
  };
}

function readEvidenceLinks(value: unknown): Array<{ artifactId: string; explanation: string }> {
  if (!Array.isArray(value)) throw new Error("Persisted risk assessment has invalid evidence links");
  return value.map((link) => {
    if (typeof link !== "object" || link === null || Array.isArray(link)) {
      throw new Error("Persisted risk assessment has an invalid evidence link");
    }
    const record = link as Record<string, unknown>;
    return {
      artifactId: readString(record.artifactId),
      explanation: readString(record.explanation)
    };
  });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Persisted risk assessment has an invalid list");
  return value.map(readString);
}

function readString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Persisted risk assessment has invalid text");
  }
  return value;
}

function toReleaseView(release: {
  attempt: number;
  componentVersion: { component: { name: string }; version: string };
  id: string;
  status: string;
}): ReleaseView {
  if (
    release.componentVersion.component.name !== "pricing" ||
    (release.componentVersion.version !== "v2" && release.componentVersion.version !== "v2.1")
  ) {
    throw new Error("Release does not reference a bundled Pricing candidate");
  }

  return {
    attempt: release.attempt,
    candidateVersion: release.componentVersion.version as BundledPricingCandidate,
    id: release.id,
    status: release.status as ReleaseStatus
  };
}
