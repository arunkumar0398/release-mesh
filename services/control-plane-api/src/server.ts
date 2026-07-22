import { pathToFileURL } from "node:url";

import {
  CatalogRepository,
  createPrismaClient,
  IdempotencyConflictError,
  ReleaseRepository,
  resetDemo,
  WorkerHeartbeatRepository
} from "@releasemesh/database";
import { createReleaseQueue } from "@releasemesh/runner-worker/queue";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import { HealthService } from "./health-service.js";
import { DemoResetBusyError, DemoResetService } from "./demo-reset-service.js";
import {
  ReleaseNotFoundError,
  ReleaseOrchestrator,
  ReleaseQueueUnavailableError,
  ReleaseRetryConflictError
} from "./release-orchestrator.js";
import {
  registerComponentRoutes,
  type ComponentRoutesDependencies
} from "./routes/components.js";
import {
  registerDependencyRoutes,
  type DependencyRoutesDependencies
} from "./routes/dependencies.js";
import {
  registerDemoResetRoutes,
  type DemoResetRoutesDependencies
} from "./routes/demo-reset.js";
import { registerHealthRoutes, type HealthRoutesDependencies } from "./routes/healthz.js";
import { registerReleaseRoutes, type ReleaseRoutesDependencies } from "./routes/releases.js";

export interface ControlPlaneDependencies {
  catalog: ComponentRoutesDependencies & DependencyRoutesDependencies;
  demoReset?: DemoResetRoutesDependencies;
  health: HealthRoutesDependencies;
  releases: ReleaseRoutesDependencies;
}

export interface ControlPlaneServerOptions {
  allowedOrigins?: string[];
  demoResetToken?: string;
}

export function buildControlPlaneServer(
  dependencies: ControlPlaneDependencies,
  logger = false,
  { allowedOrigins = [], demoResetToken }: ControlPlaneServerOptions = {}
): FastifyInstance {
  const server = Fastify({ logger });
  if (allowedOrigins.length > 0) {
    void server.register(cors, {
      origin: (origin, callback) => callback(null, origin !== undefined && allowedOrigins.includes(origin))
    });
  }
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof IdempotencyConflictError) {
      return reply.code(409).send({ message: error.message });
    }
    if (error instanceof ReleaseQueueUnavailableError) {
      request.log.error({ correlationId: request.id, error: error.cause }, error.message);
      return reply.code(503).send({ message: error.message });
    }
    if (error instanceof ReleaseNotFoundError) {
      return reply.code(404).send({ message: error.message });
    }
    if (error instanceof ReleaseRetryConflictError) {
      return reply.code(409).send({ message: error.message });
    }
    if (error instanceof DemoResetBusyError) {
      return reply.code(409).send({ message: error.message });
    }
    if (isValidationError(error)) {
      return reply.code(error.statusCode ?? 400).send({ message: error.message });
    }
    request.log.error({ correlationId: request.id, error }, "Unhandled control-plane error");
    return reply.code(500).send({ message: "Internal server error" });
  });
  registerComponentRoutes(server, dependencies.catalog);
  registerDependencyRoutes(server, dependencies.catalog);
  if (dependencies.demoReset && demoResetToken) {
    registerDemoResetRoutes(server, dependencies.demoReset, demoResetToken);
  }
  registerReleaseRoutes(server, dependencies.releases);
  registerHealthRoutes(server, dependencies.health);
  return server;
}

function isValidationError(
  error: unknown
): error is Error & { statusCode?: number; validation: unknown[] } {
  return error instanceof Error
    && "validation" in error
    && Array.isArray((error as { validation?: unknown }).validation);
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
  const demoReset = new DemoResetService({
    queue: queue.raw,
    resetDatabase: () => resetDemo(prisma)
  });
  const server = buildControlPlaneServer({
    catalog: {
      getComponent: (componentId) => catalogRepository.findComponentById(componentId),
      listComponents: () => catalogRepository.listComponents(),
      listDependencies: () => catalogRepository.listDependencies()
    },
    demoReset,
    health,
    releases
  }, true, {
    allowedOrigins: readAllowedOrigins(process.env.CONTROL_PLANE_ALLOWED_ORIGINS),
    demoResetToken: requiredEnvironment("DEMO_RESET_TOKEN")
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

export function readAllowedOrigins(value: string | undefined): string[] {
  return value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = await startControlPlaneServer();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void runtime.close().then(() => process.exit(0)));
  }
}
