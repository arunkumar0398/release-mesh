import type { ReleaseStatus } from "@releasemesh/contracts";

export function cappedExponentialBackoff(attemptsMade: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attemptsMade - 1), 30_000);
}

export async function recoverStrandedTestingReleases({
  olderThan,
  releaseRepository
}: {
  olderThan: Date;
  releaseRepository: {
    findTestingBefore(cutoff: Date): Promise<Array<{ id: string }>>;
    transitionRelease(input: {
      correlationId: string;
      errorCode: string;
      expectedStatus: ReleaseStatus;
      nextStatus: ReleaseStatus;
      reason: string;
      releaseId: string;
    }): Promise<unknown>;
  };
}): Promise<string[]> {
  const stranded = await releaseRepository.findTestingBefore(olderThan);

  for (const release of stranded) {
    await releaseRepository.transitionRelease({
      correlationId: `recovery:${release.id}`,
      errorCode: "WORKER_STALLED",
      expectedStatus: "TESTING",
      nextStatus: "ERROR",
      reason: "Runner heartbeat expired while release was TESTING",
      releaseId: release.id
    });
  }

  return stranded.map((release) => release.id);
}

export function startWorkerHeartbeat({
  heartbeatRepository,
  intervalMs,
  workerId
}: {
  heartbeatRepository: { record(workerId: string, seenAt: Date): Promise<void> };
  intervalMs: number;
  workerId: string;
}): { ready: Promise<void>; stop(): Promise<void> } {
  let pending = heartbeatRepository.record(workerId, new Date());
  const interval = setInterval(() => {
    pending = heartbeatRepository.record(workerId, new Date());
  }, intervalMs);
  interval.unref?.();

  return {
    ready: pending,
    stop: async () => {
      clearInterval(interval);
      await pending;
    }
  };
}
