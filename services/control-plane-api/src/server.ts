import { pathToFileURL } from "node:url";

import {
  CatalogRepository,
  createPrismaClient,
  IdempotencyConflictError,
  ReleaseRepository,
  WorkerHeartbeatRepository
} from "@releasemesh/database";
import { createReleaseQueue } from "@releasemesh/runner-worker/queue";
import Fastify, { type FastifyInstance } from "fastify";

import { HealthService } from "./health-service.js";
import { ReleaseOrchestrator, ReleaseQueueUnavailableError } from "./release-orchestrator.js";
import {
  registerComponentRoutes,
  type ComponentRoutesDependencies
} from "./routes/components.js";
import {
  registerDependencyRoutes,
  type DependencyRoutesDependencies
} from "./routes/dependencies.js";
import { registerHealthRoutes, type HealthRoutesDependencies } from "./routes/healthz.js";
import { registerReleaseRoutes, type ReleaseRoutesDependencies } from "./routes/releases.js";

export interface ControlPlaneDependencies {
  catalog: ComponentRoutesDependencies & DependencyRoutesDependencies;
  health: HealthRoutesDependencies;
  releases: ReleaseRoutesDependencies;
}

export function buildControlPlaneServer(dependencies: ControlPlaneDependencies): FastifyInstance {
  const server = Fastify({ logger: false });
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply.code(409).send({ message: error.message });
    }
    if (error instanceof ReleaseQueueUnavailableError) {
      return reply.code(503).send({ message: error.message });
    }
    return reply.send(error);
  });
  registerComponentRoutes(server, dependencies.catalog);
  registerDependencyRoutes(server, dependencies.catalog);
  registerReleaseRoutes(server, dependencies.releases);
  registerHealthRoutes(server, dependencies.health);
  return server;
}

export async function startControlPlaneServer() {
  const redisUrl = requiredEnvironment("REDIS_URL");
  const port = Number.parseInt(process.env.PORT ?? "4000", 10);
  const prisma = createPrismaClient();
  await prisma.$connect();
  const queue = createReleaseQueue({ redisUrl });
  const catalogRepository = new CatalogRepository(prisma);
  const releaseRepository = new ReleaseRepository(prisma);
  const heartbeatRepository = new WorkerHeartbeatRepository(prisma);
  const health = new HealthService({
    databaseCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    heartbeatRepository,
    heartbeatTtlMs: Number.parseInt(process.env.WORKER_HEARTBEAT_TTL_MS ?? "30000", 10),
    redisCheck: async () => {
      await queue.raw.getJobCounts("waiting");
    }
  });
  const releases = new ReleaseOrchestrator({ catalogRepository, queue, releaseRepository });
  const server = buildControlPlaneServer({
    catalog: {
      getComponent: (componentId) => catalogRepository.findComponentById(componentId),
      listComponents: () => catalogRepository.listComponents(),
      listDependencies: () => catalogRepository.listDependencies()
    },
    health,
    releases
  });
  await server.listen({ host: "0.0.0.0", port });

  return {
    address: server.server.address(),
    close: async () => {
      await server.close();
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
  const runtime = await startControlPlaneServer();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void runtime.close().then(() => process.exit(0)));
  }
}
