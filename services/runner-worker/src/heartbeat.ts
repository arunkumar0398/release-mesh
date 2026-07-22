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
