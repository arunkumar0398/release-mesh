import type {
  ArtifactInput,
  ArtifactStore,
  RetrievedArtifact,
  StoredArtifact
} from "@releasemesh/contracts";

import { ArtifactStorageKind, Prisma, PrismaClient } from "../generated/prisma/client.js";

const artifactPolicies = {
  CONTRACT_DIFF: { contentType: "application/json", maxBytes: 262_144 },
  SANITIZED_LOG: { contentType: "text/plain", maxBytes: 65_536 },
  SCREENSHOT: { contentType: "image/png", maxBytes: 1_048_576 }
} as const;

export class PostgresArtifactStore implements ArtifactStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async get(id: string): Promise<RetrievedArtifact | null> {
    const artifact = await this.prisma.evidenceArtifact.findUnique({ where: { id } });

    if (!artifact) {
      return null;
    }

    return {
      content: artifact.contentType === "application/json"
        ? JSON.stringify(artifact.jsonContent)
        : artifact.textContent ?? artifact.binaryContent ?? new Uint8Array(),
      contentType: artifact.contentType,
      id: artifact.id,
      kind: artifact.kind,
      releaseId: artifact.releaseId,
      sizeBytes: artifact.sizeBytes,
      testRunId: artifact.testRunId ?? undefined
    };
  }

  public async put(input: ArtifactInput): Promise<StoredArtifact> {
    validateArtifact(input);
    const payload = toDatabasePayload(input);
    const artifact = await this.prisma.evidenceArtifact.create({
      data: {
        binaryContent: payload.binaryContent,
        contentType: input.contentType,
        jsonContent: payload.jsonContent,
        kind: input.kind,
        releaseId: input.releaseId,
        sizeBytes: payload.sizeBytes,
        storageKind: ArtifactStorageKind.POSTGRES,
        testRunId: input.testRunId,
        textContent: payload.textContent
      }
    });

    return {
      contentType: artifact.contentType,
      id: artifact.id,
      kind: artifact.kind,
      releaseId: artifact.releaseId,
      sizeBytes: artifact.sizeBytes,
      testRunId: artifact.testRunId ?? undefined
    };
  }
}

function toDatabasePayload(input: ArtifactInput) {
  if (typeof input.content !== "string") {
    return {
      binaryContent: Uint8Array.from(input.content),
      jsonContent: undefined,
      sizeBytes: input.content.byteLength,
      textContent: undefined
    };
  }

  if (input.contentType === "application/json") {
    const jsonContent = JSON.parse(input.content);

    return {
      binaryContent: undefined,
      jsonContent: jsonContent === null ? Prisma.JsonNull : (jsonContent as Prisma.InputJsonValue),
      sizeBytes: Buffer.byteLength(input.content),
      textContent: undefined
    };
  }

  return {
    binaryContent: undefined,
    jsonContent: undefined,
    sizeBytes: Buffer.byteLength(input.content),
    textContent: input.kind === "SANITIZED_LOG" ? sanitizeLog(input.content) : input.content
  };
}

function validateArtifact(input: ArtifactInput): void {
  const policy = artifactPolicies[input.kind as keyof typeof artifactPolicies];

  if (!policy || policy.contentType !== input.contentType) {
    throw new Error("Unsupported artifact content type");
  }

  const sizeBytes = typeof input.content === "string" ? Buffer.byteLength(input.content) : input.content.byteLength;
  if (sizeBytes > policy.maxBytes) {
    throw new Error("Artifact exceeds the size limit");
  }
}

function sanitizeLog(content: string): string {
  return content
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(database_url\s*=\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]");
}
