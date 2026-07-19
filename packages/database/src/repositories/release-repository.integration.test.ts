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
