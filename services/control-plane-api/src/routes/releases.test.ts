import { afterEach, describe, expect, it, vi } from "vitest";
import { IdempotencyConflictError } from "@releasemesh/database";

import { ReleaseQueueUnavailableError } from "../release-orchestrator.js";
import { buildControlPlaneServer, type ControlPlaneDependencies } from "../server.js";

const release = {
  attempt: 0,
  candidateVersion: "v2" as const,
  id: "release-123",
  status: "QUEUED" as const
};

function createDependencies(): ControlPlaneDependencies {
  return {
    catalog: {
      getComponent: vi.fn().mockResolvedValue({ id: "pricing", name: "pricing" }),
      listComponents: vi.fn().mockResolvedValue([{ id: "pricing", name: "pricing" }]),
      listDependencies: vi.fn().mockResolvedValue([{ id: "checkout-pricing" }])
    },
    health: {
      getHealth: vi.fn().mockResolvedValue({
        database: "up",
        redis: "up",
        status: "ok",
        worker: { fresh: true, lastSeenAt: "2026-07-20T10:00:00.000Z" }
      })
    },
    releases: {
      getRelease: vi.fn().mockResolvedValue(release),
      listArtifacts: vi.fn().mockResolvedValue([{
        binaryContent: null,
        contentType: "application/json",
        createdAt: "2026-07-21T10:00:00.000Z",
        id: "artifact-1",
        jsonContent: { compatible: false },
        kind: "CONTRACT_DIFF",
        sizeBytes: 20,
        testRunId: "run-1",
        textContent: null
      }]),
      retryRelease: vi.fn().mockResolvedValue({ ...release, attempt: 1 }),
      submitRelease: vi.fn().mockResolvedValue({ created: true, release })
    }
  };
}

const servers: Array<ReturnType<typeof buildControlPlaneServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("release routes", () => {
  it("requires an idempotency key", async () => {
    const dependencies = createDependencies();
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const response = await server.inject({
      method: "POST",
      payload: { candidateVersion: "v2" },
      url: "/releases"
    });

    expect(response.statusCode).toBe(400);
    expect(dependencies.releases.submitRelease).not.toHaveBeenCalled();
  });

  it.each(["v1", "v3", "latest", "../../repository"])(
    "rejects the non-candidate Pricing version %s",
    async (candidateVersion) => {
      const dependencies = createDependencies();
      const server = buildControlPlaneServer(dependencies);
      servers.push(server);

      const response = await server.inject({
        headers: { "idempotency-key": `candidate-${candidateVersion}` },
        method: "POST",
        payload: { candidateVersion },
        url: "/releases"
      });

      expect(response.statusCode).toBe(400);
      expect(dependencies.releases.submitRelease).not.toHaveBeenCalled();
    }
  );

  it("submits only a bundled Pricing release candidate", async () => {
    const dependencies = createDependencies();
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const response = await server.inject({
      headers: { "idempotency-key": "release-v2" },
      method: "POST",
      payload: { candidateVersion: "v2" },
      url: "/releases"
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(release);
    expect(dependencies.releases.submitRelease).toHaveBeenCalledWith({
      candidateVersion: "v2",
      correlationId: expect.any(String),
      idempotencyKey: "release-v2"
    });
  });

  it("returns the original release for an idempotent duplicate", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.releases.submitRelease).mockResolvedValue({
      created: false,
      release
    });
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const response = await server.inject({
      headers: { "idempotency-key": "release-v2" },
      method: "POST",
      payload: { candidateVersion: "v2" },
      url: "/releases"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(release);
  });

  it.each([
    [new IdempotencyConflictError(), 409],
    [new ReleaseQueueUnavailableError(new Error("Redis unavailable")), 503]
  ])("maps known creation failure to HTTP %s", async (failure, expectedStatus) => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.releases.submitRelease).mockRejectedValue(failure);
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const response = await server.inject({
      headers: { "idempotency-key": "known-failure" },
      method: "POST",
      payload: { candidateVersion: "v2" },
      url: "/releases"
    });

    expect(response.statusCode).toBe(expectedStatus);
  });

  it("returns releases and retries through the orchestration boundary", async () => {
    const dependencies = createDependencies();
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const getResponse = await server.inject({ method: "GET", url: "/releases/release-123" });
    const retryResponse = await server.inject({ method: "POST", url: "/releases/release-123/retry" });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual(release);
    expect(retryResponse.statusCode).toBe(202);
    expect(dependencies.releases.retryRelease).toHaveBeenCalledWith({
      correlationId: expect.any(String),
      releaseId: "release-123"
    });
  });

  it("returns durable release evidence", async () => {
    const dependencies = createDependencies();
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/releases/release-123/artifacts"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: "artifact-1", kind: "CONTRACT_DIFF" })
    ]);
    expect(dependencies.releases.listArtifacts).toHaveBeenCalledWith("release-123");
  });
});

describe("catalogue and health routes", () => {
  it("exposes components, dependencies, and worker heartbeat freshness", async () => {
    const dependencies = createDependencies();
    const server = buildControlPlaneServer(dependencies);
    servers.push(server);

    const [components, component, dependenciesResponse, health] = await Promise.all([
      server.inject({ method: "GET", url: "/components" }),
      server.inject({ method: "GET", url: "/components/pricing" }),
      server.inject({ method: "GET", url: "/dependencies" }),
      server.inject({ method: "GET", url: "/healthz" })
    ]);

    expect(components.statusCode).toBe(200);
    expect(components.json()).toEqual([{ id: "pricing", name: "pricing" }]);
    expect(component.statusCode).toBe(200);
    expect(component.json()).toEqual({ id: "pricing", name: "pricing" });
    expect(dependenciesResponse.statusCode).toBe(200);
    expect(dependenciesResponse.json()).toEqual([{ id: "checkout-pricing" }]);
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      worker: { fresh: true }
    });
  });
});
