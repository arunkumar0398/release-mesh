import type { ReleaseStatus } from "@releasemesh/contracts";

export function cappedExponentialBackoff(attemptsMade: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attemptsMade - 1), 30_000);
}

export async function recoverStrandedTestingReleases({
  olderThan,
  onError = (error: Error) => console.error(error),
  queue,
  releaseRepository
}: {
  olderThan: Date;
  onError?: (error: Error) => void;
  queue?: {
    getJob(releaseId: string): Promise<
      | {
          data: { attempt: number };
          getState(): Promise<string>;
        }
      | null
      | undefined
    >;
  };
  releaseRepository: {
    findTestingBefore(cutoff: Date): Promise<Array<{ attempt: number; id: string }>>;
    transitionRelease(input: {
      correlationId: string;
      errorCode: string;
      expectedAttempt?: number;
      expectedStatus: ReleaseStatus;
      nextStatus: ReleaseStatus;
      reason: string;
      releaseId: string;
    }): Promise<unknown>;
  };
}): Promise<string[]> {
  const stranded = await releaseRepository.findTestingBefore(olderThan);
  const recovered: string[] = [];

  for (const release of stranded) {
    try {
      const job = await queue?.getJob(release.id);
      if (job && job.data.attempt === release.attempt) {
        const state = await job.getState();
        if (state === "active" || state === "delayed" || state === "waiting") continue;
      }
      await releaseRepository.transitionRelease({
        correlationId: `recovery:${release.id}`,
        errorCode: "WORKER_STALLED",
        expectedAttempt: release.attempt,
        expectedStatus: "TESTING",
        nextStatus: "ERROR",
        reason: "Runner heartbeat expired while release was TESTING",
        releaseId: release.id
      });
      recovered.push(release.id);
    } catch (error) {
      onError(error instanceof Error ? error : new Error(`Failed to recover release: ${release.id}`));
    }
  }

  return recovered;
}

export async function runRecoveryTasks(tasks: Array<() => Promise<unknown>>): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, "Recovery sweep failed");
}

export function startWorkerHeartbeat({
  heartbeatRepository,
  intervalMs,
  onError = (error: Error) => console.error(error),
  workerId
}: {
  heartbeatRepository: { record(workerId: string, seenAt: Date): Promise<void> };
  intervalMs: number;
  onError?: (error: Error) => void;
  workerId: string;
}): { ready: Promise<void>; stop(): Promise<void> } {
  let pending = Promise.resolve();
  const record = () => {
    pending = pending.then(() => heartbeatRepository.record(workerId, new Date())).catch((error: unknown) => {
      onError(error instanceof Error ? error : new Error("Worker heartbeat failed"));
    });
    return pending;
  };
  const ready = record();
  const interval = setInterval(() => {
    void record();
  }, intervalMs);
  interval.unref?.();

  return {
    ready,
    stop: async () => {
      clearInterval(interval);
      await pending;
    }
  };
}
