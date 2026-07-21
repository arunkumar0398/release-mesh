import type { FastifyInstance } from "fastify";

export interface DependencyRoutesDependencies {
  listDependencies(): Promise<unknown[]>;
}

export function registerDependencyRoutes(
  server: FastifyInstance,
  catalog: DependencyRoutesDependencies
): void {
  server.get("/dependencies", async () => catalog.listDependencies());
}
