// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReleaseApp } from "./ReleaseApp.js";
import type {
  ReleaseAppClient,
  ReleaseArtifact,
  ReleaseDetails,
  ReleaseSummary
} from "./api.js";
import { ReleaseApiError } from "./api.js";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const queuedRelease: ReleaseSummary = {
  attempt: 0,
  candidateVersion: "v2",
  id: "release-v2",
  status: "QUEUED"
};

const blockedRelease: ReleaseDetails = {
  ...queuedRelease,
  status: "BLOCKED",
  testRuns: [
    {
      attempt: 0,
      endedAt: "2026-07-21T12:00:03.000Z",
      id: "run-contract",
      startedAt: "2026-07-21T12:00:02.000Z",
      status: "FAILED",
      testId: "contract-pricing"
    },
    {
      attempt: 0,
      endedAt: "2026-07-21T12:00:05.000Z",
      id: "run-browser",
      startedAt: "2026-07-21T12:00:04.000Z",
      status: "FAILED",
      testId: "browser-checkout"
    }
  ],
  transitions: [
    transition(null, "DRAFT", 0),
    transition("DRAFT", "VALIDATING", 1),
    transition("VALIDATING", "QUEUED", 2),
    transition("QUEUED", "TESTING", 3),
    transition("TESTING", "ANALYZING", 4),
    transition("ANALYZING", "BLOCKED", 5)
  ]
};

const errorRelease: ReleaseDetails = {
  ...blockedRelease,
  status: "ERROR",
  testRuns: [],
  transitions: [
    transition(null, "DRAFT", 0),
    transition("DRAFT", "VALIDATING", 1),
    transition("VALIDATING", "QUEUED", 2),
    {
      ...transition("QUEUED", "ERROR", 3),
      errorCode: "WORKER_ATTEMPTS_EXHAUSTED",
      reason: "Worker attempts exhausted"
    }
  ]
};

const artifacts: ReleaseArtifact[] = [
  {
    attempt: 0,
    binaryContent: null,
    contentType: "application/json",
    createdAt: "2026-07-21T12:00:03.000Z",
    id: "artifact-contract",
    jsonContent: { compatible: false, removedFields: ["price", "currency"] },
    kind: "CONTRACT_DIFF",
    sizeBytes: 72,
    testRunId: "run-contract",
    textContent: null
  },
  {
    attempt: 0,
    binaryContent: "iVBORw0KGgo=",
    contentType: "image/png",
    createdAt: "2026-07-21T12:00:05.000Z",
    id: "artifact-browser",
    jsonContent: null,
    kind: "SCREENSHOT",
    sizeBytes: 8,
    testRunId: "run-browser",
    textContent: null
  }
];

describe("ReleaseApp", () => {
  it("creates a fixed Pricing v2 release and renders its deterministic BLOCKED evidence", async () => {
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease: vi.fn().mockResolvedValue(blockedRelease),
      listArtifacts: vi.fn().mockResolvedValue(artifacts)
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));

    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent(
      "BLOCKED"
    );
    expect(client.createRelease).toHaveBeenCalledWith("v2", expect.stringMatching(/^release-v2-/), expect.any(Object));
    expect(client.getRelease).toHaveBeenCalledWith("release-v2", expect.any(Object));
    expect(client.listArtifacts).toHaveBeenCalledWith("release-v2", expect.any(Object));

    const lifecycle = screen.getByRole("region", { name: "Release lifecycle" });
    expect(within(lifecycle).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("DRAFT"),
      expect.stringContaining("VALIDATING"),
      expect.stringContaining("QUEUED"),
      expect.stringContaining("TESTING"),
      expect.stringContaining("ANALYZING"),
      expect.stringContaining("BLOCKED")
    ]);

    const testRuns = screen.getByRole("region", { name: "Mandatory test runs" });
    expect(within(testRuns).getByText("contract-pricing")).toBeInTheDocument();
    expect(within(testRuns).getByText("browser-checkout")).toBeInTheDocument();
    expect(within(testRuns).getAllByText("FAILED")).toHaveLength(2);

    const evidence = screen.getByRole("region", { name: "Release evidence" });
    expect(within(evidence).getByText("CONTRACT_DIFF")).toBeInTheDocument();
    expect(within(evidence).getByText(/removedFields/)).toBeInTheDocument();
    expect(within(evidence).getByRole("img", { name: "SCREENSHOT evidence" })).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgo="
    );
  });

  it("creates a separate Pricing v2.1 release and renders SAFE", async () => {
    const safeRelease: ReleaseDetails = {
      ...blockedRelease,
      candidateVersion: "v2.1",
      id: "release-v2-1",
      status: "SAFE",
      testRuns: blockedRelease.testRuns.map((testRun) => ({ ...testRun, status: "PASSED" })),
      transitions: blockedRelease.transitions.map((item, index, all) =>
        index === all.length - 1 ? { ...item, toStatus: "SAFE" } : item
      )
    };
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue({
        attempt: 0,
        candidateVersion: "v2.1",
        id: safeRelease.id,
        status: "QUEUED"
      }),
      getRelease: vi.fn().mockResolvedValue(safeRelease),
      listArtifacts: vi.fn().mockResolvedValue([])
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2.1" }));

    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent(
      "SAFE"
    );
    expect(client.createRelease).toHaveBeenCalledWith("v2.1", expect.stringMatching(/^release-v2-1-/), expect.any(Object));
  });

  it("shows API failures without replacing them with an inferred gate", async () => {
    const client = createClient({
      createRelease: vi.fn().mockRejectedValue(new Error("Release queue unavailable"))
    });

    render(<ReleaseApp client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Release queue unavailable");
    expect(screen.queryByRole("status", { name: "Deterministic release gate" })).not.toBeInTheDocument();
  });

  it("reuses an unresolved submission idempotency key", async () => {
    const createRelease = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(queuedRelease);
    const client = createClient({
      createRelease,
      getRelease: vi.fn().mockResolvedValue(blockedRelease),
      listArtifacts: vi.fn().mockResolvedValue(artifacts)
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("BLOCKED");

    expect(createRelease).toHaveBeenCalledTimes(2);
    expect(createRelease.mock.calls[1]?.[1]).toBe(createRelease.mock.calls[0]?.[1]);
  });

  it("retains unresolved keys independently when candidates are switched", async () => {
    const createRelease = vi.fn()
      .mockRejectedValueOnce(new TypeError("v2 request unresolved"))
      .mockRejectedValueOnce(new TypeError("v2.1 request unresolved"))
      .mockResolvedValueOnce(queuedRelease);
    const client = createClient({
      createRelease,
      getRelease: vi.fn().mockResolvedValue(blockedRelease),
      listArtifacts: vi.fn().mockResolvedValue(artifacts)
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("v2 request unresolved");
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2.1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("v2.1 request unresolved");
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("BLOCKED");

    expect(createRelease.mock.calls[2]?.[1]).toBe(createRelease.mock.calls[0]?.[1]);
    expect(createRelease.mock.calls[1]?.[1]).not.toBe(createRelease.mock.calls[0]?.[1]);
  });

  it("recovers an unresolved submission key after remount", async () => {
    const firstCreateRelease = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const firstRender = render(<ReleaseApp client={createClient({ createRelease: firstCreateRelease })} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
    const unresolvedKey = firstCreateRelease.mock.calls[0]?.[1];
    firstRender.unmount();

    const secondCreateRelease = vi.fn().mockResolvedValue(queuedRelease);
    render(<ReleaseApp client={createClient({
      createRelease: secondCreateRelease,
      getRelease: vi.fn().mockResolvedValue(blockedRelease),
      listArtifacts: vi.fn().mockResolvedValue(artifacts)
    })} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("BLOCKED");

    expect(secondCreateRelease.mock.calls[0]?.[1]).toBe(unresolvedKey);
  });

  it("uses a fresh idempotency key after a definitive submission rejection", async () => {
    const createRelease = vi.fn()
      .mockRejectedValueOnce(new ReleaseApiError("Release request rejected", 409))
      .mockResolvedValueOnce(queuedRelease);
    const client = createClient({
      createRelease,
      getRelease: vi.fn().mockResolvedValue(blockedRelease),
      listArtifacts: vi.fn().mockResolvedValue(artifacts)
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Release request rejected");
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("BLOCKED");

    expect(createRelease.mock.calls[1]?.[1]).not.toBe(createRelease.mock.calls[0]?.[1]);
  });

  it("reuses the idempotency key after an uncertain server failure", async () => {
    const createRelease = vi.fn()
      .mockRejectedValueOnce(new ReleaseApiError("Release queue unavailable", 503))
      .mockResolvedValueOnce(errorRelease);
    const client = createClient({
      createRelease,
      getRelease: vi.fn().mockResolvedValue(errorRelease),
      listArtifacts: vi.fn().mockResolvedValue([])
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Release queue unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("ERROR");

    expect(createRelease.mock.calls[1]?.[1]).toBe(createRelease.mock.calls[0]?.[1]);
  });

  it("keeps the deterministic gate visible when evidence loading fails and supports retry", async () => {
    const listArtifacts = vi.fn()
      .mockRejectedValueOnce(new Error("Evidence unavailable"))
      .mockResolvedValueOnce(artifacts);
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease: vi.fn().mockResolvedValue(blockedRelease),
      listArtifacts
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));

    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("BLOCKED");
    expect(screen.getByRole("alert")).toHaveTextContent("Evidence unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry evidence" }));
    expect(await screen.findByText("CONTRACT_DIFF")).toBeInTheDocument();
    expect(listArtifacts).toHaveBeenCalledTimes(2);
  });

  it("pauses stalled polling without inventing a gate and can resume", async () => {
    const getRelease = vi.fn()
      .mockResolvedValueOnce({ ...blockedRelease, status: "QUEUED", testRuns: [], transitions: [] })
      .mockResolvedValueOnce(blockedRelease);
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease,
      listArtifacts: vi.fn().mockResolvedValue(artifacts)
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} pollTimeoutMs={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Status checks paused");
    expect(screen.queryByRole("status", { name: "Deterministic release gate" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume status checks" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("BLOCKED");
  });

  it("aborts a hung status request when the polling deadline expires", async () => {
    const getRelease = vi.fn((_releaseId: string, signal?: AbortSignal) => new Promise<ReleaseDetails>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Request aborted", "AbortError")), { once: true });
    }));
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} pollTimeoutMs={25} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Status checks paused");
    expect(screen.getByRole("button", { name: "Resume status checks" })).toBeEnabled();
    expect(screen.queryByRole("status", { name: "Deterministic release gate" })).not.toBeInTheDocument();
  });

  it("settles a signal-ignoring status request when the component unmounts", async () => {
    vi.useFakeTimers();
    const getRelease = vi.fn(() => new Promise<ReleaseDetails>(() => undefined));
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease
    });

    const view = render(<ReleaseApp client={client} pollTimeoutMs={10_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    await act(async () => Promise.resolve());
    expect(getRelease).toHaveBeenCalledOnce();
    const timersBeforeUnmount = vi.getTimerCount();
    expect(timersBeforeUnmount).toBeGreaterThan(0);

    view.unmount();
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBe(timersBeforeUnmount - 1);
  });

  it("caps polling backoff to the remaining deadline", async () => {
    vi.useFakeTimers();
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease: vi.fn().mockResolvedValue({
        ...blockedRelease,
        status: "QUEUED",
        testRuns: [],
        transitions: []
      })
    });

    render(<ReleaseApp client={client} pollIntervalMs={100} pollTimeoutMs={25} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    await act(async () => Promise.resolve());
    await act(async () => {
      vi.advanceTimersByTime(25);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Status checks paused");
  });

  it("retries an ERROR release through the fixed retry endpoint", async () => {
    const retriedRelease: ReleaseDetails = {
      ...blockedRelease,
      attempt: 1,
      status: "SAFE",
      testRuns: blockedRelease.testRuns.map((testRun) => ({ ...testRun, attempt: 1, status: "PASSED" })),
      transitions: [
        ...errorRelease.transitions,
        { ...transition("ERROR", "QUEUED", 4), attempt: 1 },
        { ...transition("QUEUED", "TESTING", 5), attempt: 1 },
        { ...transition("TESTING", "ANALYZING", 6), attempt: 1 },
        { ...transition("ANALYZING", "SAFE", 7), attempt: 1 }
      ]
    };
    const retryRelease = vi.fn().mockResolvedValue({
      ...queuedRelease,
      attempt: 1
    });
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease: vi.fn().mockResolvedValueOnce(errorRelease).mockResolvedValueOnce(retriedRelease),
      listArtifacts: vi.fn().mockResolvedValue([]),
      retryRelease
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("ERROR");
    fireEvent.click(screen.getByRole("button", { name: "Retry release" }));

    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("SAFE");
    expect(screen.getByText("1", { selector: ".release-summary strong" })).toBeInTheDocument();
    expect(retryRelease).toHaveBeenCalledWith("release-v2", expect.any(Object));
  });

  it("keeps the ERROR gate visible when an explicit retry fails", async () => {
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease: vi.fn().mockResolvedValue(errorRelease),
      listArtifacts: vi.fn().mockResolvedValue([]),
      retryRelease: vi.fn().mockRejectedValue(new Error("Release retry unavailable"))
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("ERROR");
    fireEvent.click(screen.getByRole("button", { name: "Retry release" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Release retry unavailable");
    expect(screen.getByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("ERROR");
  });

  it("reconciles an accepted retry when its response is lost", async () => {
    const queuedRetry = { ...queuedRelease, attempt: 1 };
    const safeRetry: ReleaseDetails = {
      ...blockedRelease,
      attempt: 1,
      status: "SAFE",
      testRuns: blockedRelease.testRuns.map((testRun) => ({ ...testRun, attempt: 1, status: "PASSED" }))
    };
    const getRelease = vi.fn()
      .mockResolvedValueOnce(errorRelease)
      .mockResolvedValueOnce({ ...errorRelease, ...queuedRetry })
      .mockResolvedValueOnce(safeRetry);
    const client = createClient({
      createRelease: vi.fn().mockResolvedValue(queuedRelease),
      getRelease,
      listArtifacts: vi.fn().mockResolvedValue([]),
      retryRelease: vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    });

    render(<ReleaseApp client={client} pollIntervalMs={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Validate Pricing v2" }));
    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("ERROR");
    fireEvent.click(screen.getByRole("button", { name: "Retry release" }));

    expect(await screen.findByRole("status", { name: "Deterministic release gate" })).toHaveTextContent("SAFE");
    expect(getRelease).toHaveBeenCalledTimes(3);
  });
});

function transition(
  fromStatus: ReleaseDetails["transitions"][number]["fromStatus"],
  toStatus: ReleaseDetails["transitions"][number]["toStatus"],
  offsetSeconds: number
): ReleaseDetails["transitions"][number] {
  return {
    attempt: 0,
    createdAt: `2026-07-21T12:00:0${offsetSeconds}.000Z`,
    errorCode: null,
    fromStatus,
    id: `transition-${offsetSeconds}`,
    reason: null,
    toStatus
  };
}

function createClient(overrides: Partial<ReleaseAppClient>): ReleaseAppClient {
  return {
    createRelease: vi.fn(),
    getRelease: vi.fn(),
    listArtifacts: vi.fn(),
    retryRelease: vi.fn(),
    ...overrides
  };
}
