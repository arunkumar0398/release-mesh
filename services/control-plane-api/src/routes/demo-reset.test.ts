import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoResetBusyError } from "../demo-reset-service.js";
import { buildControlPlaneServer } from "../server.js";

const servers: Array<ReturnType<typeof buildControlPlaneServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function createServer(reset = vi.fn().mockResolvedValue(undefined)) {
  const dependencies = {
    catalog: {
      getComponent: vi.fn(),
      listComponents: vi.fn(),
      listDependencies: vi.fn()
    },
    demoReset: { reset },
    health: { getHealth: vi.fn() },
    releases: {
      getRelease: vi.fn(),
      listArtifacts: vi.fn(),
      retryRelease: vi.fn(),
      submitRelease: vi.fn()
    }
  };
  const options = { demoResetToken: "reset-secret" };
  const server = buildControlPlaneServer(dependencies, false, options);
  servers.push(server);
  return { reset, server };
}

describe("demo reset route", () => {
  it.each([undefined, "wrong-secret"])("rejects a missing or invalid reset token", async (token) => {
    const { reset, server } = createServer();
    const response = await server.inject({
      headers: token ? { "x-demo-reset-token": token } : {},
      method: "POST",
      url: "/demo/reset"
    });

    expect(response.statusCode).toBe(401);
    expect(reset).not.toHaveBeenCalled();
  });

  it("accepts no arbitrary reset input", async () => {
    const { reset, server } = createServer();
    const response = await server.inject({
      headers: { "x-demo-reset-token": "reset-secret" },
      method: "POST",
      payload: { releaseId: "arbitrary" },
      url: "/demo/reset"
    });

    expect(response.statusCode).toBe(400);
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets the fixed demo baseline with a valid server-side token", async () => {
    const { reset, server } = createServer();
    const response = await server.inject({
      headers: { "x-demo-reset-token": "reset-secret" },
      method: "POST",
      payload: {},
      url: "/demo/reset"
    });

    expect(response.statusCode).toBe(204);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("reports a conflict when a release job is active", async () => {
    const { server } = createServer(vi.fn().mockRejectedValue(new DemoResetBusyError()));
    const response = await server.inject({
      headers: { "x-demo-reset-token": "reset-secret" },
      method: "POST",
      payload: {},
      url: "/demo/reset"
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message: "Demo reset is unavailable while a release job is active"
    });
  });
});
