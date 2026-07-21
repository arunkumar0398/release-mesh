// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReleaseApp } from "./ReleaseApp.js";
import type {
  ReleaseAppClient,
  ReleaseArtifact,
  ReleaseDetails,
  ReleaseSummary
} from "./api.js";

afterEach(() => {
  cleanup();
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
    expect(client.createRelease).toHaveBeenCalledWith("v2", expect.stringMatching(/^release-v2-/));
    expect(client.getRelease).toHaveBeenCalledWith("release-v2");
    expect(client.listArtifacts).toHaveBeenCalledWith("release-v2");

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
    expect(client.createRelease).toHaveBeenCalledWith("v2.1", expect.stringMatching(/^release-v2-1-/));
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
    ...overrides
  };
}
