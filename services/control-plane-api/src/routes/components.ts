import type { FastifyInstance } from "fastify";

export interface ComponentRoutesDependencies {
  getComponent(componentId: string): Promise<unknown | null>;
  listComponents(): Promise<unknown[]>;
}

export function registerComponentRoutes(
  server: FastifyInstance,
  catalog: ComponentRoutesDependencies
): void {
  server.get("/components", async () => catalog.listComponents());
  server.get<{ Params: { componentId: string } }>(
    "/components/:componentId",
    async (request, reply) => {
      const component = await catalog.getComponent(request.params.componentId);
      return component === null
        ? reply.code(404).send({ message: "Component not found" })
        : component;
    }
  );
}
