import { randomUUID } from "node:crypto";

import { Queue, type ConnectionOptions, type Job } from "bullmq";

export const releaseQueueName = "release-validation";
export const releaseJobName = "validate-release";

export interface ReleaseJobData {
  attempt: number;
  releaseId: string;
}

export interface ReleaseQueuePort {
  enqueue(releaseId: string, attempt?: number): Promise<void>;
  getJob(releaseId: string): Promise<Job<ReleaseJobData> | null | undefined>;
  removeTerminalJob(releaseId: string, expectedAttempt?: number): Promise<void>;
  withReleaseLock<T>(releaseId: string, operation: () => Promise<T>): Promise<T>;
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
  lockLeaseMs = 15_000,
  queueName = releaseQueueName,
  redisUrl
}: {
  lockLeaseMs?: number;
  queueName?: string;
  redisUrl: string;
}): ReleaseQueue {
  const connection = createRedisConnection(redisUrl);
  const raw = new Queue<ReleaseJobData>(queueName, { connection });
  const withReleaseLock = async <T>(releaseId: string, operation: () => Promise<T>): Promise<T> => {
    const client = await raw.client as unknown as {
      eval(script: string, keyCount: number, ...arguments_: string[]): Promise<unknown>;
      set(key: string, value: string, mode: "PX", duration: number, condition: "NX"): Promise<string | null>;
    };
    const lockKey = raw.toKey(`release-lock:${releaseId}`);
    const token = randomUUID();
    const deadline = Date.now() + 10_000;
    while (await client.set(lockKey, token, "PX", lockLeaseMs, "NX") !== "OK") {
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring release lock: ${releaseId}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    let pendingRenewal = Promise.resolve();
    const renewal = setInterval(() => {
      pendingRenewal = pendingRenewal.then(async () => {
        const renewed = await client.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
          1,
          lockKey,
          token,
          String(lockLeaseMs)
        );
        return renewed;
      }).then(() => undefined, () => undefined);
    }, Math.max(10, Math.floor(lockLeaseMs / 3)));
    renewal.unref?.();
    try {
      const result = await operation();
      await pendingRenewal;
      return result;
    } finally {
      clearInterval(renewal);
      await pendingRenewal;
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token
      );
    }
  };

  return {
    close: async () => raw.close(),
    connection,
    enqueue: async (releaseId, attempt = 0) => {
      await raw.add(
        releaseJobName,
        { attempt, releaseId },
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
    removeTerminalJob: async (releaseId, expectedAttempt) => {
      const job = await raw.getJob(releaseId);
      if (!job) return;
      if (expectedAttempt !== undefined && job.data.attempt !== expectedAttempt) return;

      const state = await job.getState();
      if (state !== "completed" && state !== "failed") {
        throw new Error(`Cannot remove non-terminal release job: ${state}`);
      }
      await job.remove();
    },
    withReleaseLock
  };
}

export async function reconcileQueuedReleases({
  olderThan,
  onError = (error: Error) => console.error(error),
  queue,
  releaseRepository
}: {
  olderThan: Date;
  onError?: (error: Error) => void;
  queue: ReleaseQueuePort;
  releaseRepository: {
    findReleaseById(releaseId: string): Promise<{ attempt: number; id: string; status: string } | null>;
    findQueuedBefore(cutoff: Date): Promise<Array<{ attempt: number; id: string }>>;
  };
}): Promise<string[]> {
  const queuedReleases = await releaseRepository.findQueuedBefore(olderThan);
  const requeued: string[] = [];

  for (const release of queuedReleases) {
    try {
      await queue.withReleaseLock(release.id, async () => {
        const current = await releaseRepository.findReleaseById(release.id);
        if (!current || current.status !== "QUEUED" || current.attempt !== release.attempt) return;
        const existing = await queue.getJob(release.id);
        if (existing) {
          const state = await existing.getState();
          if (state !== "completed" && state !== "failed") return;
          await queue.removeTerminalJob(release.id, existing.data.attempt);
        }
        await queue.enqueue(release.id, current.attempt);
        requeued.push(release.id);
      });
    } catch (error) {
      onError(error instanceof Error ? error : new Error(`Failed to reconcile release: ${release.id}`));
    }
  }

  return requeued;
}

export function startQueuedReleaseReconciler({
  intervalMs,
  onError = (error: Error) => console.error(error),
  reconcile
}: {
  intervalMs: number;
  onError?: (error: Error) => void;
  reconcile(): Promise<void>;
}): { ready: Promise<void>; stop(): Promise<void> } {
  let pending = Promise.resolve();
  const run = () => {
    pending = pending.then(reconcile).catch((error: unknown) => {
      onError(error instanceof Error ? error : new Error("Release reconciliation failed"));
    });
    return pending;
  };
  const ready = run();
  const interval = setInterval(() => void run(), intervalMs);
  interval.unref?.();

  return {
    ready,
    stop: async () => {
      clearInterval(interval);
      await pending;
    }
  };
}
