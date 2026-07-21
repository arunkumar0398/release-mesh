import { Queue, type ConnectionOptions, type Job } from "bullmq";

export const releaseQueueName = "release-validation";
export const releaseJobName = "validate-release";

export interface ReleaseJobData {
  releaseId: string;
}

export interface ReleaseQueuePort {
  enqueue(releaseId: string): Promise<void>;
  getJob(releaseId: string): Promise<Job<ReleaseJobData> | null | undefined>;
  removeTerminalJob(releaseId: string): Promise<void>;
}

export interface ReleaseQueue extends ReleaseQueuePort {
  close(): Promise<void>;
  connection: ConnectionOptions;
  name: string;
  raw: Queue<ReleaseJobData>;
}

export function createRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss");
  }

  const databasePath = url.pathname.replace(/^\//, "");
  return {
    db: databasePath === "" ? 0 : Number.parseInt(databasePath, 10),
    host: url.hostname,
    password: url.password === "" ? undefined : decodeURIComponent(url.password),
    port: url.port === "" ? 6379 : Number.parseInt(url.port, 10),
    tls: url.protocol === "rediss:" ? {} : undefined,
    username: url.username === "" ? undefined : decodeURIComponent(url.username)
  };
}

export function createReleaseQueue({
  queueName = releaseQueueName,
  redisUrl
}: {
  queueName?: string;
  redisUrl: string;
}): ReleaseQueue {
  const connection = createRedisConnection(redisUrl);
  const raw = new Queue<ReleaseJobData>(queueName, { connection });

  return {
    close: async () => raw.close(),
    connection,
    enqueue: async (releaseId) => {
      await raw.add(
        releaseJobName,
        { releaseId },
        {
          attempts: 3,
          backoff: { delay: 1_000, type: "release-capped-exponential" },
          jobId: releaseId,
          removeOnComplete: false,
          removeOnFail: false
        }
      );
    },
    getJob: async (releaseId) => raw.getJob(releaseId),
    name: queueName,
    raw,
    removeTerminalJob: async (releaseId) => {
      const job = await raw.getJob(releaseId);
      if (!job) return;

      const state = await job.getState();
      if (state !== "completed" && state !== "failed") {
        throw new Error(`Cannot remove non-terminal release job: ${state}`);
      }
      await job.remove();
    }
  };
}

export async function reconcileQueuedReleases({
  olderThan,
  queue,
  releaseRepository
}: {
  olderThan: Date;
  queue: ReleaseQueuePort;
  releaseRepository: {
    findQueuedBefore(cutoff: Date): Promise<Array<{ id: string }>>;
  };
}): Promise<string[]> {
  const queuedReleases = await releaseRepository.findQueuedBefore(olderThan);
  const requeued: string[] = [];

  for (const release of queuedReleases) {
    if (await queue.getJob(release.id)) continue;
    await queue.enqueue(release.id);
    requeued.push(release.id);
  }

  return requeued;
}
