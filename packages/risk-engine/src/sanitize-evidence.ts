import type { DeterministicReleaseGate } from "@releasemesh/contracts";

export interface ArtifactResultEvidence {
  artifactId: string;
  result: unknown;
}

export interface BrowserEvidence {
  artifactId: string;
  screenshot: {
    contentType: string;
    sizeBytes: number;
  };
  summary: string;
}

export interface OwnershipEvidence {
  component: string;
  ownerTeam: string;
}

export interface SanitizedLogEvidence {
  artifactId: string;
  content: string;
}

export interface RiskEvidenceInput {
  apiAssertions: ArtifactResultEvidence | null;
  browser: BrowserEvidence | null;
  contractDiff: ArtifactResultEvidence | null;
  deterministicGate: DeterministicReleaseGate;
  ownership: OwnershipEvidence[];
  releaseId: string;
  sanitizedLogs: SanitizedLogEvidence[];
}

export type SanitizedRiskEvidence = RiskEvidenceInput;

const sensitiveKeyPattern = /(?:authorization|cookie|set-cookie|credentials?|aws_access_key_id|aws_secret_access_key|aws_session_token|azure_client_secret|google_application_credentials|google_api_key|database_url|databaseurl|redis_url|redisurl|api[_-]?key|password|token|secret)/i;
const apiAssertionKeys = ["errorCode", "missingFields", "outcome", "statusCode", "testId"] as const;
const contractDiffKeys = [
  "addedFields",
  "compatible",
  "missingFields",
  "renamedFields",
  "typeMismatches"
] as const;

export function sanitizeEvidence(evidence: RiskEvidenceInput): SanitizedRiskEvidence {
  return {
    apiAssertions: sanitizeArtifactResult(evidence.apiAssertions, apiAssertionKeys),
    browser: evidence.browser === null ? null : {
      artifactId: sanitizeText(evidence.browser.artifactId),
      screenshot: {
        contentType: sanitizeText(evidence.browser.screenshot.contentType),
        sizeBytes: evidence.browser.screenshot.sizeBytes
      },
      summary: sanitizeText(evidence.browser.summary)
    },
    contractDiff: sanitizeArtifactResult(evidence.contractDiff, contractDiffKeys),
    deterministicGate: evidence.deterministicGate,
    ownership: evidence.ownership.slice(0, 20).map((owner) => ({
      component: sanitizeText(owner.component),
      ownerTeam: sanitizeText(owner.ownerTeam)
    })),
    releaseId: sanitizeText(evidence.releaseId),
    sanitizedLogs: evidence.sanitizedLogs.slice(0, 20).map((log) => ({
      artifactId: sanitizeText(log.artifactId),
      content: sanitizeLogContent(log.content)
    }))
  };
}

function sanitizeArtifactResult(
  value: ArtifactResultEvidence | null,
  allowedKeys: readonly string[]
): ArtifactResultEvidence | null {
  return value === null ? null : {
    artifactId: sanitizeText(value.artifactId),
    result: sanitizeKnownRecord(value.result, allowedKeys)
  };
}

function sanitizeKnownRecord(value: unknown, allowedKeys: readonly string[]): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(allowedKeys.flatMap((key) => (
    Object.hasOwn(record, key) ? [[key, sanitizeUnknown(record[key])]] : []
  )));
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeUnknown(entry, depth + 1));
  if (typeof value !== "object") return String(value);

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(
    ([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[REDACTED]" : sanitizeUnknown(entry, depth + 1)
    ]
  ));
}

function sanitizeText(content: string): string {
  const bounded = content.slice(0, 16_384);
  return bounded
    .replace(
      /(^|[,{\s])((?:authorization|cookie|set-cookie)\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^,\r\n}\s]+)/gim,
      "$1$2[REDACTED]"
    )
    .replace(
      /((?:^|[,{\s])(?:credentials?|aws_access_key_id|aws_secret_access_key|aws_session_token|azure_client_secret|google_application_credentials|google_api_key|database_url|databaseurl|redis_url|redisurl|api[_-]?key|password|token|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\s}\r\n]+)/gim,
      "$1[REDACTED]"
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED]");
}

function sanitizeLogContent(content: string): string {
  const maximumLength = 16_384;
  const normalized = content.trimStart();
  const looksStructured = normalized.startsWith("{") || normalized.startsWith("[");
  if (looksStructured) {
    if (content.length > maximumLength) return "[REDACTED: INVALID STRUCTURED LOG]";
    try {
      return JSON.stringify(sanitizeKnownRecord(JSON.parse(content) as unknown, apiAssertionKeys));
    } catch {
      return "[REDACTED: INVALID STRUCTURED LOG]";
    }
  }
  return sanitizeText(content.slice(0, maximumLength));
}
