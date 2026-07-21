import { assertTransition, type ReleaseStatus } from "@releasemesh/contracts";

import { Prisma, PrismaClient, ReleaseStatus as DatabaseReleaseStatus } from "../generated/prisma/client.js";

export interface CreateReleaseInput {
  componentVersionId: string;
  correlationId: string;
  idempotencyKey: string;
}

export interface ReleaseTransitionInput {
  correlationId: string;
  errorCode?: string;
  expectedAttempt?: number;
  expectedStatus: ReleaseStatus;
  nextStatus: ReleaseStatus;
  reason?: string;
  releaseId: string;
}

export class IdempotencyConflictError extends Error {
  public constructor() {
    super("Idempotency key was already used for a different release payload");
    this.name = "IdempotencyConflictError";
  }
}

export class ReleaseRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public findQueuedBefore(olderThan: Date) {
    return this.prisma.releaseCandidate.findMany({
      orderBy: { updatedAt: "asc" },
      where: {
        status: DatabaseReleaseStatus.QUEUED,
        updatedAt: { lt: olderThan }
      }
    });
  }

  public findTestingBefore(olderThan: Date) {
    return this.prisma.releaseCandidate.findMany({
      orderBy: { updatedAt: "asc" },
      where: {
        status: DatabaseReleaseStatus.TESTING,
        updatedAt: { lt: olderThan }
      }
    });
  }

  public findReleaseById(releaseId: string) {
    return this.prisma.releaseCandidate.findUnique({
      include: { componentVersion: { include: { component: true } } },
      where: { id: releaseId }
    });
  }

  public listArtifacts(releaseId: string) {
    return this.prisma.evidenceArtifact.findMany({
      include: { testRun: { select: { attempt: true } } },
      orderBy: { createdAt: "asc" },
      where: { releaseId }
    });
  }

  public async createRelease(input: CreateReleaseInput) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.releaseCandidate.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });

        if (existing) {
          assertMatchingReleasePayload(existing.componentVersionId, input.componentVersionId);
          return { created: false, release: existing };
        }

        const release = await transaction.releaseCandidate.create({
          data: {
            componentVersionId: input.componentVersionId,
            idempotencyKey: input.idempotencyKey,
            status: DatabaseReleaseStatus.DRAFT
          }
        });

        await transaction.releaseTransition.create({
          data: {
            attempt: release.attempt,
            correlationId: input.correlationId,
            fromStatus: null,
            releaseId: release.id,
            toStatus: DatabaseReleaseStatus.DRAFT
          }
        });

        return { created: true, release };
      }, { maxWait: 5_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }

      const release = await this.prisma.releaseCandidate.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });

      if (!release) {
        throw error;
      }

      assertMatchingReleasePayload(release.componentVersionId, input.componentVersionId);
      return { created: false, release };
    }
  }

  public async createQueuedRelease(input: CreateReleaseInput) {
    assertTransition(null, "DRAFT");
    assertTransition("DRAFT", "VALIDATING");
    assertTransition("VALIDATING", "QUEUED");

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.releaseCandidate.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });
        if (existing) {
          assertMatchingReleasePayload(existing.componentVersionId, input.componentVersionId);
          return { created: false, release: existing };
        }

        const release = await transaction.releaseCandidate.create({
          data: {
            componentVersionId: input.componentVersionId,
            idempotencyKey: input.idempotencyKey,
            status: DatabaseReleaseStatus.DRAFT
          }
        });
        const transitionTime = Date.now();
        await transaction.releaseTransition.createMany({
          data: [
            {
              attempt: release.attempt,
              correlationId: input.correlationId,
              createdAt: new Date(transitionTime),
              fromStatus: null,
              releaseId: release.id,
              toStatus: DatabaseReleaseStatus.DRAFT
            },
            {
              attempt: release.attempt,
              correlationId: input.correlationId,
              createdAt: new Date(transitionTime + 1),
              fromStatus: DatabaseReleaseStatus.DRAFT,
              releaseId: release.id,
              toStatus: DatabaseReleaseStatus.VALIDATING
            },
            {
              attempt: release.attempt,
              correlationId: input.correlationId,
              createdAt: new Date(transitionTime + 2),
              fromStatus: DatabaseReleaseStatus.VALIDATING,
              releaseId: release.id,
              toStatus: DatabaseReleaseStatus.QUEUED
            }
          ]
        });
        const queued = await transaction.releaseCandidate.update({
          data: { status: DatabaseReleaseStatus.QUEUED, version: { increment: 2 } },
          where: { id: release.id }
        });
        return { created: true, release: queued };
      }, { maxWait: 5_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }

      const release = await this.prisma.releaseCandidate.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      if (!release) throw error;
      assertMatchingReleasePayload(release.componentVersionId, input.componentVersionId);
      return { created: false, release };
    }
  }

  public async retryRelease(releaseId: string, correlationId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const release = await transaction.releaseCandidate.findUnique({ where: { id: releaseId } });

      if (!release) {
        throw new Error(`Release not found: ${releaseId}`);
      }

      if (release.status !== DatabaseReleaseStatus.ERROR) {
        throw new Error("Only ERROR releases can be retried");
      }

      const nextAttempt = release.attempt + 1;
      const update = await transaction.releaseCandidate.updateMany({
        data: {
          attempt: nextAttempt,
          status: DatabaseReleaseStatus.QUEUED,
          version: { increment: 1 }
        },
        where: {
          id: releaseId,
          status: DatabaseReleaseStatus.ERROR,
          version: release.version
        }
      });

      if (update.count !== 1) {
        throw new Error("Release status changed before retry could be applied");
      }

      await transaction.releaseTransition.create({
        data: {
          attempt: nextAttempt,
          correlationId,
          fromStatus: DatabaseReleaseStatus.ERROR,
          releaseId,
          toStatus: DatabaseReleaseStatus.QUEUED
        }
      });

      return transaction.releaseCandidate.findUniqueOrThrow({ where: { id: releaseId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  public async transitionRelease(input: ReleaseTransitionInput) {
    return this.prisma.$transaction(async (transaction) => {
      const release = await transaction.releaseCandidate.findUnique({ where: { id: input.releaseId } });

      if (!release) {
        throw new Error(`Release not found: ${input.releaseId}`);
      }

      if (release.status !== input.expectedStatus) {
        throw new Error("Release status changed before transition could be applied");
      }
      if (input.expectedAttempt !== undefined && release.attempt !== input.expectedAttempt) {
        throw new Error("Release attempt changed before transition could be applied");
      }

      assertTransition(input.expectedStatus, input.nextStatus);

      const update = await transaction.releaseCandidate.updateMany({
        data: {
          status: input.nextStatus as DatabaseReleaseStatus,
          version: { increment: 1 }
        },
        where: {
          id: input.releaseId,
          attempt: input.expectedAttempt,
          status: input.expectedStatus as DatabaseReleaseStatus,
          version: release.version
        }
      });

      if (update.count !== 1) {
        throw new Error("Release status changed before transition could be applied");
      }

      await transaction.releaseTransition.create({
        data: {
          attempt: release.attempt,
          correlationId: input.correlationId,
          errorCode: input.errorCode,
          fromStatus: input.expectedStatus as DatabaseReleaseStatus,
          reason: input.reason,
          releaseId: input.releaseId,
          toStatus: input.nextStatus as DatabaseReleaseStatus
        }
      });

      return transaction.releaseCandidate.findUniqueOrThrow({ where: { id: input.releaseId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

function assertMatchingReleasePayload(
  existingComponentVersionId: string,
  requestedComponentVersionId: string
): void {
  if (existingComponentVersionId !== requestedComponentVersionId) {
    throw new IdempotencyConflictError();
  }
}
