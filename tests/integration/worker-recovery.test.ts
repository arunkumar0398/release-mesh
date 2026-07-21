import { randomUUID } from "node:crypto";

import { PrismaClient } from "../../packages/database/src/generated/prisma/client.js";
import { ReleaseRepository } from "../../packages/database/src/repositories/release-repository.js";
import { WorkerHeartbeatRepository } from "../../packages/database/src/repositories/worker-heartbeat-repository.js";
import { HealthService } from "../../services/control-plane-api/src/health-service.js";
import { startReleaseWorker } from "../../services/runner-worker/src/index.js";
import { createReleaseQueue } from "../../services/runner-worker/src/queues/release-queue.js";
import {
  recoverStrandedTestingReleases,
  startWorkerHeartbeat
} from "../../services/runner-worker/src/recovery.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const closeables: Array<{ close(): Promise<void> }> = [];

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.evidenceArtifact.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.releaseTransition.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
  await prisma.workerHeartbeat.deleteMany();
});
afterAll(async () => {
  await Promise.all(closeables.splice(0).reverse().map((closeable) => closeable.close()));
  await prisma.$disconnect();
});

async function createRelease(status: "QUEUED" | "TESTING") {
  const releaseRepository = new ReleaseRepository(prisma);
  const component = await prisma.component.create({
    data: { kind: "FIXTURE", name: `pricing-${randomUUID()}`, ownerTeam: "pricing-platform" }
  });
  const version = await prisma.componentVersion.create({
    data: { componentId: component.id, version: "v2" }
  });
  const created = await releaseRepository.createRelease({
    componentVersionId: version.id,
    correlationId: "worker-recovery",
    idempotencyKey: randomUUID()
  });
  await releaseRepository.transitionRelease({
    correlationId: "worker-recovery",
    expectedStatus: "DRAFT",
    nextStatus: "VALIDATING",
    releaseId: created.release.id
  });
  await releaseRepository.transitionRelease({
    correlationId: "worker-recovery",
    expectedStatus: "VALIDATING",
    nextStatus: "QUEUED",
    releaseId: created.release.id
  });
  if (status === "TESTING") {
    await releaseRepository.transitionRelease({
      correlationId: "worker-recovery",
      expectedStatus: "QUEUED",
      nextStatus: "TESTING",
      releaseId: created.release.id
    });
  }
  return created.release;
}

async function waitForError(releaseId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const release = await prisma.releaseCandidate.findUniqueOrThrow({ where: { id: releaseId } });
    if (release.status === "ERROR") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ERROR: ${releaseId}`);
}

describe("worker recovery", () => {
  it("persists an exhausted worker crash as ERROR and then removes the failed job", async () => {
    const release = await createRelease("QUEUED");
    const releaseRepository = new ReleaseRepository(prisma);
    const queue = createReleaseQueue({ queueName: `worker-crash-${randomUUID()}`, redisUrl });
    closeables.push(queue);
    const processor = {
      process: vi.fn(async () => {
        const current = await releaseRepository.findReleaseById(release.id);
        if (current?.status === "QUEUED") {
          await releaseRepository.transitionRelease({
            correlationId: "crashing-worker",
            expectedStatus: "QUEUED",
            nextStatus: "TESTING",
            releaseId: release.id
          });
        }
        throw new Error("worker crashed");
      })
    };
    const worker = startReleaseWorker({
      onError: vi.fn(),
      processor,
      queue,
      releaseRepository
    });
    closeables.push(worker);

    await queue.enqueue(release.id);
    await waitForError(release.id);

    await expect(
      prisma.releaseTransition.findFirst({
        orderBy: { createdAt: "desc" },
        where: { releaseId: release.id }
      })
    ).resolves.toMatchObject({ errorCode: "WORKER_CRASHED", toStatus: "ERROR" });
    await expect(queue.getJob(release.id)).resolves.toBeUndefined();
    expect(processor.process).toHaveBeenCalledTimes(3);
  }, 20_000);

  it("recovers an old TESTING release without consulting queue history", async () => {
    const release = await createRelease("TESTING");
    const releaseRepository = new ReleaseRepository(prisma);
    await prisma.releaseCandidate.update({
      data: { updatedAt: new Date(Date.now() - 60_000) },
      where: { id: release.id }
    });

    await expect(
      recoverStrandedTestingReleases({
        olderThan: new Date(Date.now() - 30_000),
        releaseRepository
      })
    ).resolves.toEqual([release.id]);
    await expect(prisma.releaseCandidate.findUniqueOrThrow({ where: { id: release.id } })).resolves.toMatchObject({
      status: "ERROR"
    });
  });

  it("persists heartbeat freshness for the control-plane health report", async () => {
    const heartbeatRepository = new WorkerHeartbeatRepository(prisma);
    const heartbeat = startWorkerHeartbeat({
      heartbeatRepository,
      intervalMs: 30_000,
      workerId: "runner-integration"
    });
    await heartbeat.ready;
    const queue = createReleaseQueue({ queueName: `health-${randomUUID()}`, redisUrl });
    closeables.push(queue);
    const service = new HealthService({
      databaseCheck: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      heartbeatRepository,
      heartbeatTtlMs: 60_000,
      redisCheck: async () => {
        await queue.raw.getJobCounts("waiting");
      }
    });

    await expect(service.getHealth()).resolves.toMatchObject({
      database: "up",
      redis: "up",
      status: "ok",
      worker: { fresh: true }
    });
    await heartbeat.stop();
  });
});
