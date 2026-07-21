import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { createServer, type ViteDevServer } from "vite";
import { Worker } from "bullmq";
import { createPricingServer } from "../../fixtures/pricing/src/server.js";
import { PrismaClient, ReleaseStatus } from "../../packages/database/src/generated/prisma/client.js";
import { PostgresArtifactStore } from "../../packages/database/src/artifacts/postgres-artifact-store.js";
import { CatalogRepository } from "../../packages/database/src/repositories/catalog-repository.js";
import { ReleaseRepository } from "../../packages/database/src/repositories/release-repository.js";
import { RiskAssessmentRepository } from "../../packages/database/src/repositories/risk-assessment-repository.js";
import { TestRunRepository } from "../../packages/database/src/repositories/test-run-repository.js";
import { analyzeRisk } from "../../packages/risk-engine/src/analyze-risk.js";
import { planReleaseTests } from "../../packages/risk-engine/src/plan-release-tests.js";
import { ReleaseOrchestrator } from "../../services/control-plane-api/src/release-orchestrator.js";
import { createPricingApiCheck } from "../../services/runner-worker/src/checks/api-check.js";
import { createCheckoutBrowserCheck } from "../../services/runner-worker/src/checks/browser-check.js";
import { startReleaseWorker } from "../../services/runner-worker/src/index.js";
import { DefaultMandatoryCheckExecutor } from "../../services/runner-worker/src/mandatory-check-executor.js";
import { ReleaseProcessor } from "../../services/runner-worker/src/release-processor.js";
import {
  createReleaseQueue,
  reconcileQueuedReleases,
  type ReleaseQueuePort
} from "../../services/runner-worker/src/queues/release-queue.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const queues: Array<ReturnType<typeof createReleaseQueue>> = [];
const pricingServers: Server[] = [];
const viteServers: ViteDevServer[] = [];
const workers: Array<ReturnType<typeof startReleaseWorker>> = [];

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.evidenceArtifact.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.releaseTransition.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});
afterAll(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
  await Promise.all(viteServers.splice(0).map((server) => server.close()));
  await Promise.all(pricingServers.splice(0).map(closeHttpServer));
  await Promise.all(queues.splice(0).map((queue) => queue.close()));
  await prisma.$disconnect();
});

async function closeHttpServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function startPricing(mode: "v2" | "v2.1"): Promise<string> {
  const server = createPricingServer({ mode });
  pricingServers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function startCheckout(pricingBaseUrl: string): Promise<string> {
  const server = await createServer({
    define: {
      "import.meta.env.VITE_PRICING_BASE_URL": JSON.stringify(pricingBaseUrl)
    },
    logLevel: "silent",
    root: resolve(import.meta.dirname, "..", "..", "fixtures", "checkout"),
    server: { host: "127.0.0.1", port: 0 }
  });
  viteServers.push(server);
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitForTerminalRelease(releaseId: string, expectedStatus: "BLOCKED" | "SAFE") {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const release = await prisma.releaseCandidate.findUnique({ where: { id: releaseId } });
    if (release?.status === expectedStatus) return release;
    if (release?.status === "ERROR") throw new Error(`Release unexpectedly entered ERROR: ${releaseId}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${expectedStatus}: ${releaseId}`);
}

async function waitForRemovedJob(queue: ReturnType<typeof createReleaseQueue>, releaseId: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await queue.getJob(releaseId))) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Terminal job was not removed: ${releaseId}`);
}

async function createPricingCandidates(): Promise<void> {
  const component = await prisma.component.create({
    data: { kind: "FIXTURE", name: "pricing", ownerTeam: "pricing-platform" }
  });
  await prisma.componentVersion.createMany({
    data: [
      { componentId: component.id, version: "v2" },
      { componentId: component.id, version: "v2.1" }
    ]
  });
}

function createOrchestrator(queue: ReleaseQueuePort): ReleaseOrchestrator {
  return new ReleaseOrchestrator({
    catalogRepository: new CatalogRepository(prisma),
    queue,
    releaseRepository: new ReleaseRepository(prisma)
  });
}

function createRiskDependencies() {
  return {
    riskAnalyzer: {
      analyze: (evidence: Parameters<typeof analyzeRisk>[0]["evidence"]) => analyzeRisk({
        client: null,
        evidence
      })
    },
    riskAssessmentRepository: new RiskAssessmentRepository(prisma),
    riskPlanner: {
      plan: async (input: Parameters<typeof planReleaseTests>[0]["input"]) => (
        await planReleaseTests({ client: null, input })
      ).selectedTestIds
    }
  };
}

describe("release queue orchestration", () => {
  it("moves a release to ERROR when enqueue is interrupted after QUEUED", async () => {
    await createPricingCandidates();
    const queue: ReleaseQueuePort = {
      enqueue: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      getJob: vi.fn(),
      removeTerminalJob: vi.fn()
    };

    await expect(
      createOrchestrator(queue).submitRelease({
        candidateVersion: "v2",
        correlationId: "enqueue-interrupted",
        idempotencyKey: "enqueue-interrupted"
      })
    ).rejects.toThrow("Release queue unavailable");

    const release = await prisma.releaseCandidate.findUniqueOrThrow({
      where: { idempotencyKey: "enqueue-interrupted" }
    });
    expect(release.status).toBe(ReleaseStatus.ERROR);
    await expect(
      prisma.releaseTransition.findMany({
        orderBy: { createdAt: "asc" },
        where: { releaseId: release.id }
      })
    ).resolves.toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "DRAFT" }),
      expect.objectContaining({ fromStatus: "DRAFT", toStatus: "VALIDATING" }),
      expect.objectContaining({ fromStatus: "VALIDATING", toStatus: "QUEUED" }),
      expect.objectContaining({
        errorCode: "QUEUE_ENQUEUE_FAILED",
        fromStatus: "QUEUED",
        toStatus: "ERROR"
      })
    ]);
    await expect(prisma.riskAssessment.findUnique({
      where: { releaseId: release.id }
    })).resolves.toMatchObject({
      assessment: expect.objectContaining({
        rootCause: expect.stringContaining("deterministic ERROR"),
        source: "deterministic/rule-based"
      }),
      status: "AI_UNAVAILABLE"
    });
  });

  it("reuses one database row and one releaseId job for duplicate requests", async () => {
    await createPricingCandidates();
    const queue = createReleaseQueue({ queueName: `release-test-${randomUUID()}`, redisUrl });
    queues.push(queue);
    const orchestrator = createOrchestrator(queue);
    const input = {
      candidateVersion: "v2.1" as const,
      correlationId: "duplicate-request",
      idempotencyKey: "duplicate-request"
    };

    const first = await orchestrator.submitRelease(input);
    const duplicate = await orchestrator.submitRelease(input);

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ created: false, release: first.release });
    await expect(prisma.releaseCandidate.count()).resolves.toBe(1);
    await expect(queue.getJob(first.release.id)).resolves.toMatchObject({
      data: { attempt: 0, releaseId: first.release.id },
      id: first.release.id
    });
  });

  it("re-enqueues a missing job for an old QUEUED release", async () => {
    await createPricingCandidates();
    const releaseRepository = new ReleaseRepository(prisma);
    const componentVersion = await prisma.componentVersion.findFirstOrThrow({ where: { version: "v2" } });
    const created = await releaseRepository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "reconcile",
      idempotencyKey: "reconcile"
    });
    await releaseRepository.transitionRelease({
      correlationId: "reconcile",
      expectedStatus: "DRAFT",
      nextStatus: "VALIDATING",
      releaseId: created.release.id
    });
    await releaseRepository.transitionRelease({
      correlationId: "reconcile",
      expectedStatus: "VALIDATING",
      nextStatus: "QUEUED",
      releaseId: created.release.id
    });
    await prisma.releaseCandidate.update({
      data: { updatedAt: new Date(Date.now() - 60_000) },
      where: { id: created.release.id }
    });
    const queue = createReleaseQueue({ queueName: `release-test-${randomUUID()}`, redisUrl });
    queues.push(queue);

    const reconciled = await reconcileQueuedReleases({
      olderThan: new Date(Date.now() - 30_000),
      queue,
      releaseRepository
    });

    expect(reconciled).toEqual([created.release.id]);
    await expect(queue.getJob(created.release.id)).resolves.toMatchObject({ id: created.release.id });
  });

  it("removes an old terminal job before retrying ERROR", async () => {
    await createPricingCandidates();
    const events: string[] = [];
    const queue: ReleaseQueuePort = {
      enqueue: vi.fn(async (_releaseId, attempt) => {
        events.push(`enqueue:${attempt}`);
      }),
      getJob: vi.fn(),
      removeTerminalJob: vi.fn(async (_releaseId, attempt) => {
        events.push(`remove:${attempt}`);
      }),
      withReleaseLock: vi.fn(async (_releaseId, operation) => {
        events.push("lock:start");
        const result = await operation();
        events.push("lock:end");
        return result;
      })
    };
    const orchestrator = createOrchestrator(queue);
    const failed = await prisma.releaseCandidate.create({
      data: {
        componentVersionId: (await prisma.componentVersion.findFirstOrThrow()).id,
        idempotencyKey: "retry",
        status: "ERROR"
      }
    });

    const retried = await orchestrator.retryRelease({
      correlationId: "retry",
      releaseId: failed.id
    });

    expect(events).toEqual(["lock:start", "remove:0", "enqueue:1", "lock:end"]);
    expect(retried.status).toBe("QUEUED");
  });

  it("replaces a retained terminal job for an old QUEUED release", async () => {
    await createPricingCandidates();
    const releaseRepository = new ReleaseRepository(prisma);
    const componentVersion = await prisma.componentVersion.findFirstOrThrow({
      where: { version: "v2" }
    });
    const created = await releaseRepository.createQueuedRelease({
      componentVersionId: componentVersion.id,
      correlationId: "reconcile-terminal",
      idempotencyKey: "reconcile-terminal"
    });
    await prisma.releaseCandidate.update({
      data: { updatedAt: new Date(Date.now() - 60_000) },
      where: { id: created.release.id }
    });
    const queue = createReleaseQueue({ queueName: `release-terminal-${randomUUID()}`, redisUrl });
    queues.push(queue);
    const staleWorker = new Worker(queue.name, async () => undefined, {
      connection: queue.connection
    });
    await queue.enqueue(created.release.id, created.release.attempt);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await (await queue.getJob(created.release.id))?.getState() === "completed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    await staleWorker.close();

    await expect(
      reconcileQueuedReleases({
        olderThan: new Date(Date.now() - 30_000),
        queue,
        releaseRepository
      })
    ).resolves.toEqual([created.release.id]);
    await expect(queue.getJob(created.release.id)).resolves.toMatchObject({
      data: { attempt: created.release.attempt }
    });
  });

  it("does not let stale cleanup remove a replacement-attempt job", async () => {
    const queue = createReleaseQueue({ queueName: `release-fence-${randomUUID()}`, redisUrl });
    queues.push(queue);
    await queue.enqueue("release-fenced", 1);

    await queue.removeTerminalJob("release-fenced", 0);

    await expect(queue.getJob("release-fenced")).resolves.toMatchObject({
      data: { attempt: 1, releaseId: "release-fenced" }
    });
  });

  it("serializes cleanup and replacement enqueue for the same release", async () => {
    const queue = createReleaseQueue({
      lockLeaseMs: 100,
      queueName: `release-lock-${randomUUID()}`,
      redisUrl
    });
    queues.push(queue);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.withReleaseLock("release-locked", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });
    while (!events.includes("first:start")) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    const client = await queue.raw.client;
    const initialLease = await client.pttl(queue.raw.toKey("release-lock:release-locked"));
    expect(initialLease).toBeGreaterThan(0);
    expect(initialLease).toBeLessThanOrEqual(100);
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    const second = queue.withReleaseLock("release-locked", async () => {
      events.push("second");
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));

    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("retries ERROR through QUEUED and TESTING to a durable terminal state", async () => {
    await createPricingCandidates();
    const releaseRepository = new ReleaseRepository(prisma);
    const componentVersion = await prisma.componentVersion.findFirstOrThrow({ where: { version: "v2.1" } });
    const created = await releaseRepository.createRelease({
      componentVersionId: componentVersion.id,
      correlationId: "retry-integration",
      idempotencyKey: "retry-integration"
    });
    await releaseRepository.transitionRelease({
      correlationId: "retry-integration",
      expectedStatus: "DRAFT",
      nextStatus: "VALIDATING",
      releaseId: created.release.id
    });
    await releaseRepository.transitionRelease({
      correlationId: "retry-integration",
      expectedStatus: "VALIDATING",
      nextStatus: "ERROR",
      releaseId: created.release.id
    });
    const queue = createReleaseQueue({ queueName: `release-retry-${randomUUID()}`, redisUrl });
    queues.push(queue);
    const staleWorker = new Worker(queue.name, async () => undefined, { connection: queue.connection });
    await queue.enqueue(created.release.id);
    const staleDeadline = Date.now() + 10_000;
    while ((await queue.getJob(created.release.id))?.getState && Date.now() < staleDeadline) {
      const staleJob = await queue.getJob(created.release.id);
      if (await staleJob?.getState() === "completed") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    await staleWorker.close();
    await expect(queue.getJob(created.release.id)).resolves.toMatchObject({ id: created.release.id });

    const processor = new ReleaseProcessor({
      artifactStore: new PostgresArtifactStore(prisma),
      mandatoryCheckExecutor: new DefaultMandatoryCheckExecutor({
        runBrowserCheck: async () => ({
          passed: true,
          screenshot: new Uint8Array([137, 80, 78, 71]),
          testId: "browser-checkout"
        }),
        runPricingApiCheck: async () => ({
          missingFields: [],
          outcome: "passed",
          statusCode: 200,
          testId: "api-pricing"
        })
      }),
      releaseRepository,
      ...createRiskDependencies(),
      testRunRepository: new TestRunRepository(prisma)
    });
    const worker = startReleaseWorker({ processor, queue, releaseRepository });
    workers.push(worker);

    await expect(
      createOrchestrator(queue).retryRelease({
        correlationId: "retry-integration",
        releaseId: created.release.id
      })
    ).resolves.toMatchObject({ attempt: 1, status: "QUEUED" });
    await waitForTerminalRelease(created.release.id, "SAFE");
    await waitForRemovedJob(queue, created.release.id);

    await expect(
      prisma.releaseTransition.findMany({
        orderBy: { createdAt: "asc" },
        where: { releaseId: created.release.id }
      })
    ).resolves.toEqual([
      expect.objectContaining({ attempt: 0, fromStatus: null, toStatus: "DRAFT" }),
      expect.objectContaining({ attempt: 0, fromStatus: "DRAFT", toStatus: "VALIDATING" }),
      expect.objectContaining({ attempt: 0, fromStatus: "VALIDATING", toStatus: "ERROR" }),
      expect.objectContaining({ attempt: 1, fromStatus: "ERROR", toStatus: "QUEUED" }),
      expect.objectContaining({ attempt: 1, fromStatus: "QUEUED", toStatus: "TESTING" }),
      expect.objectContaining({ attempt: 1, fromStatus: "TESTING", toStatus: "ANALYZING" }),
      expect.objectContaining({ attempt: 1, fromStatus: "ANALYZING", toStatus: "SAFE" })
    ]);
  }, 20_000);

  it.each([
    ["v2", "BLOCKED", ["FAILED", "FAILED", "FAILED"]],
    ["v2.1", "SAFE", ["PASSED", "PASSED", "PASSED"]]
  ] as const)(
    "runs Pricing %s through BullMQ to a durable %s release with evidence",
    async (candidateVersion, expectedStatus, expectedTestStatuses) => {
      await createPricingCandidates();
      const pricingBaseUrl = await startPricing(candidateVersion);
      const checkoutBaseUrl = await startCheckout(pricingBaseUrl);
      const queue = createReleaseQueue({ queueName: `release-test-${randomUUID()}`, redisUrl });
      queues.push(queue);
      const processor = new ReleaseProcessor({
        artifactStore: new PostgresArtifactStore(prisma),
        mandatoryCheckExecutor: new DefaultMandatoryCheckExecutor({
          runBrowserCheck: createCheckoutBrowserCheck({
            checkoutBaseUrl,
            trustedCheckoutOrigins: [checkoutBaseUrl]
          }),
          runPricingApiCheck: createPricingApiCheck({
            pricingBaseUrl,
            trustedPricingOrigins: [pricingBaseUrl]
          })
        }),
        releaseRepository: new ReleaseRepository(prisma),
        ...createRiskDependencies(),
        testRunRepository: new TestRunRepository(prisma)
      });
      const worker = startReleaseWorker({ processor, queue, releaseRepository: new ReleaseRepository(prisma) });
      workers.push(worker);

      const submitted = await createOrchestrator(queue).submitRelease({
        candidateVersion,
        correlationId: `integration-${candidateVersion}`,
        idempotencyKey: `integration-${candidateVersion}`
      });
      await waitForTerminalRelease(submitted.release.id, expectedStatus);
      await waitForRemovedJob(queue, submitted.release.id);

      const [testRuns, artifacts, transitions] = await Promise.all([
        prisma.testRun.findMany({ orderBy: { testId: "asc" }, where: { releaseId: submitted.release.id } }),
        prisma.evidenceArtifact.findMany({ where: { releaseId: submitted.release.id } }),
        prisma.releaseTransition.findMany({
          orderBy: { createdAt: "asc" },
          where: { releaseId: submitted.release.id }
        })
      ]);
      expect(testRuns.map((testRun) => testRun.status).sort()).toEqual([...expectedTestStatuses].sort());
      expect(testRuns.map((testRun) => testRun.testId).sort()).toEqual([
        "api-pricing",
        "browser-checkout",
        "contract-pricing"
      ]);
      expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual([
        "CONTRACT_DIFF",
        "SANITIZED_LOG",
        "SCREENSHOT"
      ]);
      expect(artifacts.find((artifact) => artifact.kind === "SCREENSHOT")?.binaryContent?.byteLength).toBeGreaterThan(0);
      expect(transitions.map((transition) => transition.toStatus)).toEqual([
        "DRAFT",
        "VALIDATING",
        "QUEUED",
        "TESTING",
        "ANALYZING",
        expectedStatus
      ]);
    },
    30_000
  );
});
