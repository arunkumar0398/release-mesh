import { describe, expect, it, vi } from "vitest";

import {
  loadCatalogRemote,
  loadReleaseRemote,
  type FederationRuntime
} from "./runtime-remotes.js";

describe("runtime Catalog remote loading", () => {
  it("resolves the Catalog manifest independently from remotes.json", async () => {
    const module = { CatalogApp: () => null, catalogMfeVersion: "0.1.0" };
    const runtime: FederationRuntime = {
      loadRemote: vi.fn().mockResolvedValue(module),
      registerRemotes: vi.fn()
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      catalog: {
        apiBaseUrl: "https://api.example",
        manifestUrl: "https://catalog.example/mf-manifest.json"
      },
      release: {
        apiBaseUrl: "https://api.example",
        manifestUrl: "https://release.example/mf-manifest.json"
      }
    }), { status: 200 }));

    await expect(loadCatalogRemote({ fetchImpl, runtime })).resolves.toEqual({
      ...module,
      apiBaseUrl: "https://api.example/"
    });
    expect(runtime.registerRemotes).toHaveBeenCalledWith([{
      entry: "https://catalog.example/mf-manifest.json",
      name: "catalog_mfe"
    }]);
    expect(runtime.loadRemote).toHaveBeenCalledWith("catalog_mfe/CatalogApp");
  });

  it("rejects a missing Catalog configuration without registering a remote", async () => {
    const runtime: FederationRuntime = {
      loadRemote: vi.fn(),
      registerRemotes: vi.fn()
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ release: {} }));

    await expect(loadCatalogRemote({ fetchImpl, runtime })).rejects.toThrow(
      "Catalog remote configuration is missing"
    );
    expect(runtime.registerRemotes).not.toHaveBeenCalled();
  });
});

describe("runtime Release remote loading", () => {
  it("resolves the manifest from remotes.json instead of a build-time URL", async () => {
    const module = { ReleaseApp: () => null, releaseMfeVersion: "0.1.0" };
    const runtime: FederationRuntime = {
      loadRemote: vi.fn().mockResolvedValue(module),
      registerRemotes: vi.fn()
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      release: {
        apiBaseUrl: "https://api.example",
        manifestUrl: "https://release.example/mf-manifest.json"
      }
    }), { status: 200 }));

    await expect(loadReleaseRemote({ fetchImpl, runtime })).resolves.toEqual({
      ...module,
      apiBaseUrl: "https://api.example/"
    });
    expect(fetchImpl).toHaveBeenCalledWith("/remotes.json", { cache: "no-store" });
    expect(runtime.registerRemotes).toHaveBeenCalledWith([{
      entry: "https://release.example/mf-manifest.json",
      name: "release_mfe"
    }]);
    expect(runtime.loadRemote).toHaveBeenCalledWith("release_mfe/ReleaseApp");
  });

  it("loads when the unrelated Catalog configuration is missing", async () => {
    const module = { ReleaseApp: () => null, releaseMfeVersion: "0.1.0" };
    const runtime: FederationRuntime = {
      loadRemote: vi.fn().mockResolvedValue(module),
      registerRemotes: vi.fn()
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({
      release: {
        apiBaseUrl: "/api",
        manifestUrl: "https://release.example/mf-manifest.json"
      }
    }));

    await expect(loadReleaseRemote({ fetchImpl, runtime })).resolves.toMatchObject(module);
  });

  it.each([
    [{}, "Release remote configuration is missing"],
    [{ release: { apiBaseUrl: "https://api.example", manifestUrl: "javascript:alert(1)" } }, "Release manifest URL must use HTTP or HTTPS"],
    [{ release: { apiBaseUrl: "javascript:alert(1)", manifestUrl: "https://release.example/mf-manifest.json" } }, "Control-plane API URL must use HTTP or HTTPS"],
    [{ release: { apiBaseUrl: "https://user:secret@api.example", manifestUrl: "https://release.example/mf-manifest.json" } }, "Control-plane API URL must not include credentials, a query, or a fragment"],
    [{ release: { apiBaseUrl: "https://api.example?token=secret", manifestUrl: "https://release.example/mf-manifest.json" } }, "Control-plane API URL must not include credentials, a query, or a fragment"],
    [{ release: { apiBaseUrl: "https://api.example?", manifestUrl: "https://release.example/mf-manifest.json" } }, "Control-plane API URL must not include credentials, a query, or a fragment"],
    [{ release: { apiBaseUrl: "https://api.example/#secret", manifestUrl: "https://release.example/mf-manifest.json" } }, "Control-plane API URL must not include credentials, a query, or a fragment"],
    [{ release: { apiBaseUrl: "https://api.example#", manifestUrl: "https://release.example/mf-manifest.json" } }, "Control-plane API URL must not include credentials, a query, or a fragment"]
  ])("rejects an invalid runtime remote configuration", async (body, message) => {
    const runtime: FederationRuntime = {
      loadRemote: vi.fn(),
      registerRemotes: vi.fn()
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    await expect(loadReleaseRemote({ fetchImpl, runtime })).rejects.toThrow(message);
    expect(runtime.registerRemotes).not.toHaveBeenCalled();
  });
});
