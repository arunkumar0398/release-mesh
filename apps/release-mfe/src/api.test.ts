import { afterEach, describe, expect, it, vi } from "vitest";

import { createReleaseApiClient } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("release API client", () => {
  it("uses only the fixed release and evidence endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ attempt: 0, candidateVersion: "v2", id: "release-1", status: "QUEUED" }, 201))
      .mockResolvedValueOnce(jsonResponse({ attempt: 0, candidateVersion: "v2", id: "release-1", status: "BLOCKED", testRuns: [], transitions: [] }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createReleaseApiClient("/api");

    await client.createRelease("v2", "idem-1");
    await client.getRelease("release-1");
    await client.listArtifacts("release-1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/releases", {
      body: JSON.stringify({ candidateVersion: "v2" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-1" },
      method: "POST"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/releases/release-1");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/releases/release-1/artifacts");
  });

  it("throws the stable API message for failed requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Release queue unavailable" }, 503)));

    await expect(createReleaseApiClient("/api").createRelease("v2", "idem-1")).rejects.toThrow(
      "Release queue unavailable"
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
