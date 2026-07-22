import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance } from "fastify";

export interface DemoResetRoutesDependencies {
  reset(): Promise<void>;
}

export function registerDemoResetRoutes(
  server: FastifyInstance,
  reset: DemoResetRoutesDependencies,
  expectedToken: string
): void {
  server.post<{
    Body: unknown;
    Headers: { "x-demo-reset-token"?: string };
  }>("/demo/reset", async (request, reply) => {
    if (!tokensMatch(request.headers["x-demo-reset-token"], expectedToken)) {
      return reply.code(401).send({ message: "Invalid demo reset token" });
    }
    if (!isEmptyResetBody(request.body)) {
      return reply.code(400).send({ message: "Demo reset accepts no input" });
    }
    await reset.reset();
    return reply.code(204).send();
  });
}

function isEmptyResetBody(body: unknown): boolean {
  return body === undefined
    || (typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 0);
}

function tokensMatch(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken) return false;
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
