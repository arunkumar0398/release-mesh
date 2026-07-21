import type { ReleaseStatus } from "@releasemesh/contracts";
import {
  CatalogRepository,
  ReleaseRepository
} from "@releasemesh/database";
import type { ReleaseQueuePort } from "@releasemesh/runner-worker/queue";

import type {
  BundledPricingCandidate,
  ReleaseArtifactView,
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

  public async getRelease(releaseId: string): Promise<ReleaseView | null> {
    const release = await this.dependencies.releaseRepository.findReleaseById(releaseId);
    return release ? toReleaseView(release) : null;
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
      await this.dependencies.releaseRepository.transitionRelease({
        correlationId: input.correlationId,
        errorCode: "QUEUE_ENQUEUE_FAILED",
        expectedStatus: "QUEUED",
        nextStatus: "ERROR",
        reason: error instanceof Error ? error.message : "Queue enqueue failed",
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
        await this.dependencies.releaseRepository.transitionRelease({
          correlationId,
          errorCode: "QUEUE_ENQUEUE_FAILED",
          expectedStatus: "QUEUED",
          nextStatus: "ERROR",
          reason: error instanceof Error ? error.message : "Queue enqueue failed",
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
