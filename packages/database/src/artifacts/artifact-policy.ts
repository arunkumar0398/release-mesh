import type { ArtifactContent, ArtifactInput } from "@releasemesh/contracts";

const artifactPolicies = {
  CONTRACT_DIFF: { contentType: "application/json", maxBytes: 262_144, representation: "string" },
  SANITIZED_LOG: { contentType: "text/plain", maxBytes: 65_536, representation: "string" },
  SCREENSHOT: { contentType: "image/png", maxBytes: 1_048_576, representation: "binary" }
} as const;

export interface NormalizedArtifact {
  content: ArtifactContent;
  sizeBytes: number;
}

export function normalizeArtifact(input: ArtifactInput): NormalizedArtifact {
  const policy = artifactPolicies[input.kind as keyof typeof artifactPolicies];
  if (!policy || policy.contentType !== input.contentType) {
    throw new Error("Unsupported artifact content type");
  }

  const hasExpectedRepresentation =
    (policy.representation === "string" && typeof input.content === "string") ||
    (policy.representation === "binary" && input.content instanceof Uint8Array);
  if (!hasExpectedRepresentation) {
    throw new Error("Unsupported artifact content representation");
  }

  const rawSizeBytes = sizeOf(input.content);
  if (rawSizeBytes > policy.maxBytes) {
    throw new Error("Artifact exceeds the size limit");
  }

  const content = input.kind === "SANITIZED_LOG" ? sanitizeLog(input.content as string) : input.content;
  return { content, sizeBytes: sizeOf(content) };
}

function sizeOf(content: ArtifactContent): number {
  return typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
}

function sanitizeLog(content: string): string {
  const sensitiveKeys = [
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_session_token",
    "azure_client_secret",
    "google_application_credentials",
    "google_api_key",
    "database_url",
    "databaseurl",
    "redis_url",
    "redisurl",
    "api[_-]?key",
    "password",
    "token",
    "secret"
  ].join("|");

  return content
    .replace(
      /(^|[,{]\s*)(["']?(?:authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,\r\n}]+)/gim,
      "$1$2[REDACTED]"
    )
    .replace(
      new RegExp(`((?:^|[,{]\\s*)["']?(?:${sensitiveKeys})["']?\\s*[:=]\\s*["'])[^"'\\r\\n]*(["'])`, "gim"),
      "$1[REDACTED]$2"
    )
    .replace(
      new RegExp(`((?:^|[,{]\\s*)["']?(?:${sensitiveKeys})["']?\\s*[:=]\\s*)(?!["'])[^,\\s}\\r\\n]+`, "gim"),
      "$1[REDACTED]"
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@");
}
