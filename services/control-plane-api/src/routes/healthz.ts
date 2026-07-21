import type { FastifyInstance } from "fastify";

export interface HealthReport {
  database: "up" | "down";
  redis: "up" | "down";
  status: "ok" | "degraded";
  worker: {
    fresh: boolean;
    lastSeenAt: string | null;
  };
}

export interface HealthRoutesDependencies {
  getHealth(): Promise<HealthReport>;
}

export function registerHealthRoutes(
  server: FastifyInstance,
  health: HealthRoutesDependencies
): void {
  server.get("/healthz", async (_request, reply) => {
    const report = await health.getHealth();
    return reply.code(report.status === "ok" ? 200 : 503).send(report);
  });
}
