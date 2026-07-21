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

export interface ReleaseRiskAssessmentContent {
  blastRadius: string[];
  compatibleRemediation: string;
  confidence: "HIGH" | "LOW" | "MEDIUM";
  evidenceLinks: Array<{ artifactId: string; explanation: string }>;
  rootCause: string;
  source: "GPT-5.6" | "deterministic/rule-based";
  uncertainty: string;
  verificationSteps: string[];
}

export interface ReleaseRiskAssessment {
  assessment: ReleaseRiskAssessmentContent;
  status: "AI_UNAVAILABLE" | "AVAILABLE";
}

export interface ReleaseDetails extends ReleaseSummary {
  riskAssessment: ReleaseRiskAssessment | null;
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
  createRelease(candidateVersion: PricingCandidate, idempotencyKey: string, signal?: AbortSignal): Promise<ReleaseSummary>;
  getRelease(releaseId: string, signal?: AbortSignal): Promise<ReleaseDetails>;
  listArtifacts(releaseId: string, signal?: AbortSignal): Promise<ReleaseArtifact[]>;
  retryRelease(releaseId: string, signal?: AbortSignal): Promise<ReleaseSummary>;
}

export class ReleaseApiError extends Error {
  public constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ReleaseApiError";
  }
}

export function createReleaseApiClient(apiBaseUrl = "/api"): ReleaseAppClient {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");

  return {
    createRelease: (candidateVersion, idempotencyKey, signal) => requestJson<ReleaseSummary>(
      `${baseUrl}/releases`,
      {
        body: JSON.stringify({ candidateVersion }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        method: "POST",
        ...(signal === undefined ? {} : { signal })
      }
    ),
    getRelease: (releaseId, signal) => requestJson<ReleaseDetails>(
      `${baseUrl}/releases/${encodeURIComponent(releaseId)}`,
      signal === undefined ? undefined : { signal }
    ),
    listArtifacts: (releaseId, signal) => requestJson<ReleaseArtifact[]>(
      `${baseUrl}/releases/${encodeURIComponent(releaseId)}/artifacts`,
      signal === undefined ? undefined : { signal }
    ),
    retryRelease: (releaseId, signal) => requestJson<ReleaseSummary>(
      `${baseUrl}/releases/${encodeURIComponent(releaseId)}/retry`,
      {
        method: "POST",
        ...(signal === undefined ? {} : { signal })
      }
    )
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = init === undefined ? await fetch(url) : await fetch(url, init);
  const text = await response.text();
  const body = parseJson(text, response.headers.get("content-type"));
  if (!response.ok) {
    throw new ReleaseApiError(readApiMessage(body), response.status);
  }
  return body as T;
}

function parseJson(text: string, contentType: string | null): unknown {
  if (text.length === 0 || !contentType?.toLowerCase().includes("application/json")) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
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
