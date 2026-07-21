import type { ReleaseStatus } from "@releasemesh/contracts";

export type PricingCandidate = "v2" | "v2.1";

export interface ReleaseSummary {
  attempt: number;
  candidateVersion: PricingCandidate;
  id: string;
  status: ReleaseStatus;
}

export interface ReleaseTransition {
  attempt: number;
  createdAt: string;
  errorCode: string | null;
  fromStatus: ReleaseStatus | null;
  id: string;
  reason: string | null;
  toStatus: ReleaseStatus;
}

export interface ReleaseTestRun {
  attempt: number;
  endedAt: string | null;
  id: string;
  startedAt: string | null;
  status: string;
  testId: string;
}

export interface ReleaseDetails extends ReleaseSummary {
  testRuns: ReleaseTestRun[];
  transitions: ReleaseTransition[];
}

export interface ReleaseArtifact {
  attempt: number | null;
  binaryContent: string | null;
  contentType: string;
  createdAt: string;
  id: string;
  jsonContent: unknown;
  kind: string;
  sizeBytes: number;
  testRunId: string | null;
  textContent: string | null;
}

export interface ReleaseAppClient {
  createRelease(candidateVersion: PricingCandidate, idempotencyKey: string): Promise<ReleaseSummary>;
  getRelease(releaseId: string): Promise<ReleaseDetails>;
  listArtifacts(releaseId: string): Promise<ReleaseArtifact[]>;
}

export function createReleaseApiClient(apiBaseUrl = "/api"): ReleaseAppClient {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");

  return {
    createRelease: (candidateVersion, idempotencyKey) => requestJson<ReleaseSummary>(
      `${baseUrl}/releases`,
      {
        body: JSON.stringify({ candidateVersion }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        method: "POST"
      }
    ),
    getRelease: (releaseId) => requestJson<ReleaseDetails>(
      `${baseUrl}/releases/${encodeURIComponent(releaseId)}`
    ),
    listArtifacts: (releaseId) => requestJson<ReleaseArtifact[]>(
      `${baseUrl}/releases/${encodeURIComponent(releaseId)}/artifacts`
    )
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = init === undefined ? await fetch(url) : await fetch(url, init);
  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(readApiMessage(body));
  }
  return body as T;
}

function readApiMessage(body: unknown): string {
  if (
    typeof body === "object"
    && body !== null
    && "message" in body
    && typeof (body as { message?: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }
  return "Release request failed";
}
