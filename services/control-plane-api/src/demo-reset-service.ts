export type DemoQueueState = "completed" | "failed";

export interface DemoResetQueue {
  clean(grace: number, limit: number, state: DemoQueueState): Promise<unknown>;
  drain(includeDelayed?: boolean): Promise<void>;
  getActiveCount(): Promise<number>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

export class DemoResetBusyError extends Error {
  public constructor() {
    super("Demo reset is unavailable while a release job is active");
    this.name = "DemoResetBusyError";
  }
}

export class DemoResetService {
  public constructor(private readonly dependencies: {
    queue: DemoResetQueue;
    resetDatabase(): Promise<void>;
  }) {}

  public async reset(): Promise<void> {
    await this.dependencies.queue.pause();
    try {
      if (await this.dependencies.queue.getActiveCount() > 0) {
        throw new DemoResetBusyError();
      }
      await this.dependencies.queue.drain(true);
      await this.dependencies.queue.clean(0, 1_000, "completed");
      await this.dependencies.queue.clean(0, 1_000, "failed");
      await this.dependencies.resetDatabase();
    } finally {
      await this.dependencies.queue.resume();
    }
  }
}
