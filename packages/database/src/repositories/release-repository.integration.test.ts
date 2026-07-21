import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/prisma/client.js";
import { ReleaseRepository } from "./release-repository.js";

const prisma = new PrismaClient();
const repository = new ReleaseRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.releaseTransition.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ReleaseRepository", () => {
  it("creates one idempotent DRAFT release with its initial transition", async () => {
    const componentVersion = await createPricingVersion();

    const first = await repository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "correlation-123",
      idempotencyKey: "idem-123"
    });
    const second = await repository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "correlation-123",
      idempotencyKey: "idem-123"
    });

    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, release: first.release });
    await expect(prisma.releaseTransition.findMany({ where: { releaseId: first.release.id } })).resolves.toEqual([
      expect.objectContaining({
        attempt: 0,
        correlationId: "correlation-123",
        fromStatus: null,
        toStatus: "DRAFT"
      })
    ]);
  });

  it("returns the same release for concurrent idempotent creation", async () => {
    const componentVersion = await createPricingVersion();
    const input = {
      componentVersionId: componentVersion.id,
      correlationId: "correlation-concurrent",
      idempotencyKey: "idem-concurrent"
    };

    const firstPrisma = new PrismaClient();
    const secondPrisma = new PrismaClient();
    const barrier = createBarrier(2);
    const firstRepository = new ReleaseRepository(withCreateBarrier(firstPrisma, barrier) as PrismaClient);
    const secondRepository = new ReleaseRepository(withCreateBarrier(secondPrisma, barrier) as PrismaClient);

    await Promise.all([firstPrisma.$connect(), secondPrisma.$connect()]);
    const results = await Promise.all([firstRepository.createRelease(input), secondRepository.createRelease(input)]);
    await Promise.all([firstPrisma.$disconnect(), secondPrisma.$disconnect()]);

    expect(results.map((result) => result.release.id)).toEqual([results[0].release.id, results[0].release.id]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    await expect(prisma.releaseCandidate.count({ where: { idempotencyKey: input.idempotencyKey } })).resolves.toBe(1);
    await expect(prisma.releaseTransition.findMany({ where: { releaseId: results[0].release.id } })).resolves.toEqual([
      expect.objectContaining({
        attempt: 0,
        correlationId: input.correlationId,
        fromStatus: null,
        toStatus: "DRAFT"
      })
    ]);
  });

  it("rejects idempotency-key reuse for a different release payload", async () => {
    const componentVersion = await createPricingVersion();
    const otherVersion = await prisma.componentVersion.create({
      data: {
        componentId: componentVersion.componentId,
        version: "2.0.0"
      }
    });

    await repository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "correlation-conflict",
      idempotencyKey: "idem-conflict"
    });

    await expect(
      repository.createRelease({
        componentVersionId: otherVersion.id,
        correlationId: "correlation-conflict",
        idempotencyKey: "idem-conflict"
      })
    ).rejects.toThrow("Idempotency key was already used for a different release payload");
  });

  it("atomically guards a lifecycle transition by current status", async () => {
    const componentVersion = await createPricingVersion();
    const created = await repository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "correlation-456",
      idempotencyKey: "idem-456"
    });

    const transitioned = await repository.transitionRelease({
      correlationId: "correlation-456",
      expectedStatus: "DRAFT",
      nextStatus: "VALIDATING",
      releaseId: created.release.id
    });

    expect(transitioned.status).toBe("VALIDATING");
    await expect(
      repository.transitionRelease({
        correlationId: "correlation-456",
        expectedStatus: "DRAFT",
        nextStatus: "VALIDATING",
        releaseId: created.release.id
      })
    ).rejects.toThrow("Release status changed before transition could be applied");
  });

  it("retries an ERROR release through QUEUED, TESTING, and a terminal status", async () => {
    const componentVersion = await createPricingVersion();
    const created = await repository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "correlation-retry",
      idempotencyKey: "idem-retry"
    });

    await repository.transitionRelease({
      correlationId: "correlation-retry",
      expectedStatus: "DRAFT",
      nextStatus: "VALIDATING",
      releaseId: created.release.id
    });
    await repository.transitionRelease({
      correlationId: "correlation-retry",
      expectedStatus: "VALIDATING",
      nextStatus: "ERROR",
      releaseId: created.release.id
    });

    await expect(repository.retryRelease(created.release.id, "correlation-retry")).resolves.toMatchObject({
      attempt: 1,
      status: "QUEUED"
    });
    await expect(repository.transitionRelease({
      correlationId: "stale-attempt-zero",
      expectedAttempt: 0,
      expectedStatus: "QUEUED",
      nextStatus: "ERROR",
      releaseId: created.release.id
    })).rejects.toThrow("Release attempt changed before transition could be applied");
    await expect(repository.findReleaseById(created.release.id)).resolves.toMatchObject({
      attempt: 1,
      status: "QUEUED"
    });
    await repository.transitionRelease({
      correlationId: "correlation-retry",
      expectedStatus: "QUEUED",
      nextStatus: "TESTING",
      releaseId: created.release.id
    });
    await repository.transitionRelease({
      correlationId: "correlation-retry",
      expectedStatus: "TESTING",
      nextStatus: "ANALYZING",
      releaseId: created.release.id
    });
    await expect(
      repository.transitionRelease({
        correlationId: "correlation-retry",
        expectedStatus: "ANALYZING",
        nextStatus: "SAFE",
        releaseId: created.release.id
      })
    ).resolves.toMatchObject({ status: "SAFE" });
    await expect(prisma.releaseTransition.findMany({ where: { releaseId: created.release.id }, orderBy: { createdAt: "asc" } })).resolves.toEqual([
      expect.objectContaining({ attempt: 0, fromStatus: null, toStatus: "DRAFT" }),
      expect.objectContaining({ attempt: 0, fromStatus: "DRAFT", toStatus: "VALIDATING" }),
      expect.objectContaining({ attempt: 0, fromStatus: "VALIDATING", toStatus: "ERROR" }),
      expect.objectContaining({ attempt: 1, fromStatus: "ERROR", toStatus: "QUEUED" }),
      expect.objectContaining({ attempt: 1, fromStatus: "QUEUED", toStatus: "TESTING" }),
      expect.objectContaining({ attempt: 1, fromStatus: "TESTING", toStatus: "ANALYZING" }),
      expect.objectContaining({ attempt: 1, fromStatus: "ANALYZING", toStatus: "SAFE" })
    ]);
  });
});

async function createPricingVersion() {
  const component = await prisma.component.create({
    data: {
      kind: "FIXTURE",
      name: "pricing",
      ownerTeam: "checkout-platform"
    }
  });

  return prisma.componentVersion.create({
    data: {
      componentId: component.id,
      version: "1.0.0"
    }
  });
}

function createBarrier(participants: number) {
  let arrived = 0;
  let release: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived === participants) {
      release();
    }

    await ready;
  };
}

function withCreateBarrier(prismaClient: PrismaClient, waitForAllCreates: () => Promise<void>) {
  return prismaClient.$extends({
    query: {
      releaseCandidate: {
        async create({ args, query }) {
          await waitForAllCreates();
          return query(args);
        }
      }
    }
  });
}
