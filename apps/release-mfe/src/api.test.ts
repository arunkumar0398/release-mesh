import { afterEach, describe, expect, it, vi } from "vitest";

import { createReleaseApiClient, ReleaseApiError } from "./api.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("release API client", () => {
  it("uses only the fixed release and evidence endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ attempt: 0, candidateVersion: "v2", id: "release-1", status: "QUEUED" }, 201))
      .mockResolvedValueOnce(jsonResponse({ attempt: 0, candidateVersion: "v2", id: "release-1", status: "BLOCKED", testRuns: [], transitions: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ attempt: 1, candidateVersion: "v2", id: "release-1", status: "QUEUED" }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const client = createReleaseApiClient("/api");

    await client.createRelease("v2", "idem-1");
    await client.getRelease("release-1");
    await client.listArtifacts("release-1");
    await client.retryRelease("release-1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/releases", {
      body: JSON.stringify({ candidateVersion: "v2" }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-1" },
      method: "POST"
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/releases/release-1");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/releases/release-1/artifacts");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/releases/release-1/retry", { method: "POST" });
  });

  it("throws the stable API message for failed requests", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Release queue unavailable" }, 503)));

    await expect(createReleaseApiClient("/api").createRelease("v2", "idem-1")).rejects.toMatchObject({
      message: "Release queue unavailable",
      status: 503
    } satisfies Partial<ReleaseApiError>);
  });

  it("falls back to a stable error for non-JSON gateway responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", {
      headers: { "Content-Type": "text/html" },
      status: 502
    })));

    await expect(createReleaseApiClient("/api").createRelease("v2", "idem-1")).rejects.toThrow(
      "Release request failed"
    );
  });

  it("forwards abort signals to polling and evidence requests", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ attempt: 0, candidateVersion: "v2", id: "release-1", status: "QUEUED", testRuns: [], transitions: [] }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const client = createReleaseApiClient("/api");

    await client.getRelease("release-1", signal);
    await client.listArtifacts("release-1", signal);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/releases/release-1", { signal });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/releases/release-1/artifacts", { signal });
  });

  it("uses the build-time API URL when opened as a standalone static site", async () => {
    vi.stubEnv("VITE_CONTROL_PLANE_API_URL", "https://api.example");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      attempt: 0,
      candidateVersion: "v2",
      id: "release-1",
      status: "QUEUED"
    }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createReleaseApiClient().createRelease("v2", "standalone");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example/releases", expect.any(Object));
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
