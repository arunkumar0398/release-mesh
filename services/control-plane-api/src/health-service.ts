import type { HealthReport } from "./routes/healthz.js";

export interface HealthServiceDependencies {
  clock?: () => Date;
  databaseCheck(): Promise<void>;
  heartbeatRepository: {
    findLatest(): Promise<{ seenAt: Date } | null>;
  };
  heartbeatTtlMs: number;
  redisCheck(): Promise<void>;
}

export class HealthService {
  public constructor(private readonly dependencies: HealthServiceDependencies) {}

  public async getHealth(): Promise<HealthReport> {
    const [database, redis, heartbeat] = await Promise.allSettled([
      this.dependencies.databaseCheck(),
      this.dependencies.redisCheck(),
      this.dependencies.heartbeatRepository.findLatest()
    ]);
    const latest = heartbeat.status === "fulfilled" ? heartbeat.value : null;
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const fresh = latest !== null && now.getTime() - latest.seenAt.getTime() <= this.dependencies.heartbeatTtlMs;
    const databaseStatus = database.status === "fulfilled" ? "up" : "down";
    const redisStatus = redis.status === "fulfilled" ? "up" : "down";

    return {
      database: databaseStatus,
      redis: redisStatus,
      status: databaseStatus === "up" && redisStatus === "up" ? "ok" : "degraded",
      worker: {
        fresh,
        lastSeenAt: latest?.seenAt.toISOString() ?? null
      }
    };
  }
}
