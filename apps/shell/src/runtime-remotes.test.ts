import { describe, expect, it, vi } from "vitest";

import { loadReleaseRemote, type FederationRuntime } from "./runtime-remotes.js";

describe("runtime Release remote loading", () => {
  it("resolves the manifest from remotes.json instead of a build-time URL", async () => {
    const module = { ReleaseApp: () => null, releaseMfeVersion: "0.1.0" };
    const runtime: FederationRuntime = {
      loadRemote: vi.fn().mockResolvedValue(module),
      registerRemotes: vi.fn()
    };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      release: {
        manifestUrl: "https://release.example/mf-manifest.json"
      }
    }), { status: 200 }));

    await expect(loadReleaseRemote({ fetchImpl, runtime })).resolves.toBe(module);
    expect(fetchImpl).toHaveBeenCalledWith("/remotes.json", { cache: "no-store" });
    expect(runtime.registerRemotes).toHaveBeenCalledWith([{
      entry: "https://release.example/mf-manifest.json",
      name: "release_mfe"
    }]);
    expect(runtime.loadRemote).toHaveBeenCalledWith("release_mfe/ReleaseApp");
  });

  it.each([
    [{}, "Release remote configuration is missing"],
    [{ release: { manifestUrl: "javascript:alert(1)" } }, "Release manifest URL must use HTTP or HTTPS"]
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
