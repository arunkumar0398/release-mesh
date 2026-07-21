import { hostname } from "node:os";
import { pathToFileURL } from "node:url";

import {
  createPrismaClient,
  PostgresArtifactStore,
  ReleaseRepository,
  TestRunRepository,
  WorkerHeartbeatRepository
} from "@releasemesh/database";
import { Worker, type Job } from "bullmq";

import { createPricingApiCheck } from "./checks/api-check.js";
import { createCheckoutBrowserCheck } from "./checks/browser-check.js";
import { DefaultMandatoryCheckExecutor } from "./mandatory-check-executor.js";
import type { ReleaseProcessor } from "./release-processor.js";
import { ReleaseProcessor as DefaultReleaseProcessor } from "./release-processor.js";
import {
  cappedExponentialBackoff,
  recoverStrandedTestingReleases,
  startWorkerHeartbeat
} from "./recovery.js";
import {
  createReleaseQueue,
  reconcileQueuedReleases,
  type ReleaseJobData,
  type ReleaseQueue
} from "./queues/release-queue.js";

export function startReleaseWorker({
  onError = (error: Error) => console.error(error),
  processor,
  queue,
  releaseRepository
}: {
  onError?: (error: Error) => void;
  processor: Pick<ReleaseProcessor, "process">;
  queue: ReleaseQueue;
  releaseRepository: Pick<ReleaseRepository, "findReleaseById" | "transitionRelease">;
}): Worker<ReleaseJobData> {
  const worker = new Worker<ReleaseJobData>(
    queue.name,
    async (job) => processor.process(job.data.releaseId),
    {
      connection: queue.connection,
      settings: {
        backoffStrategy: (attemptsMade, type) => {
          if (type !== "release-capped-exponential") {
            throw new Error(`Unsupported backoff strategy: ${type}`);
          }
          return cappedExponentialBackoff(attemptsMade);
        }
      }
    }
  );

  worker.on("completed", (job) => {
    void queue.removeTerminalJob(job.data.releaseId).catch(onError);
  });
  worker.on("failed", (job, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void persistExhaustedFailure(job, error, releaseRepository)
      .then(() => queue.removeTerminalJob(job.data.releaseId))
      .catch(onError);
  });
  worker.on("error", onError);

  return worker;
}

async function persistExhaustedFailure(
  job: Job<ReleaseJobData>,
  error: Error,
  releaseRepository: Pick<ReleaseRepository, "findReleaseById" | "transitionRelease">
): Promise<void> {
  const release = await releaseRepository.findReleaseById(job.data.releaseId);
  if (!release || !["QUEUED", "TESTING", "ANALYZING"].includes(release.status)) return;

  await releaseRepository.transitionRelease({
    correlationId: `worker-failure:${job.data.releaseId}`,
    errorCode: "WORKER_CRASHED",
    expectedStatus: release.status as "QUEUED" | "TESTING" | "ANALYZING",
    nextStatus: "ERROR",
    reason: error.message,
    releaseId: job.data.releaseId
  });
}

export async function startRunnerRuntime() {
  const redisUrl = requiredEnvironment("REDIS_URL");
  const pricingBaseUrl = requiredEnvironment("PRICING_BASE_URL");
  const checkoutBaseUrl = requiredEnvironment("CHECKOUT_BASE_URL");
  const prisma = createPrismaClient();
  await prisma.$connect();
  const queue = createReleaseQueue({ redisUrl });
  const releaseRepository = new ReleaseRepository(prisma);
  const heartbeatRepository = new WorkerHeartbeatRepository(prisma);

  await reconcileQueuedReleases({
    olderThan: new Date(Date.now() - Number.parseInt(process.env.QUEUED_RECONCILE_AGE_MS ?? "30000", 10)),
    queue,
    releaseRepository
  });
  await recoverStrandedTestingReleases({
    olderThan: new Date(Date.now() - Number.parseInt(process.env.TESTING_RECOVERY_AGE_MS ?? "120000", 10)),
    releaseRepository
  });

  const heartbeat = startWorkerHeartbeat({
    heartbeatRepository,
    intervalMs: Number.parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS ?? "10000", 10),
    workerId: process.env.WORKER_ID ?? hostname()
  });
  await heartbeat.ready;
  const processor = new DefaultReleaseProcessor({
    artifactStore: new PostgresArtifactStore(prisma),
    mandatoryCheckExecutor: new DefaultMandatoryCheckExecutor({
      runBrowserCheck: createCheckoutBrowserCheck({
        checkoutBaseUrl,
        trustedCheckoutOrigins: [checkoutBaseUrl]
      }),
      runPricingApiCheck: createPricingApiCheck({
        pricingBaseUrl,
        timeoutMs: Number.parseInt(process.env.PRICING_TIMEOUT_MS ?? "5000", 10),
        trustedPricingOrigins: [pricingBaseUrl]
      })
    }),
    releaseRepository,
    testRunRepository: new TestRunRepository(prisma)
  });
  const worker = startReleaseWorker({ processor, queue, releaseRepository });
  await worker.waitUntilReady();

  return {
    close: async () => {
      await worker.close();
      await heartbeat.stop();
      await queue.close();
      await prisma.$disconnect();
    }
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startRunnerRuntime();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void runtime.close().then(() => process.exit(0)));
  }
}

export * from "./queues/release-queue.js";
export * from "./recovery.js";
export * from "./release-processor.js";
