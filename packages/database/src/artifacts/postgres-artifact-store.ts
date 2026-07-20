import type {
  ArtifactInput,
  ArtifactStore,
  RetrievedArtifact,
  StoredArtifact
} from "@releasemesh/contracts";

import { ArtifactStorageKind, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { normalizeArtifact } from "./artifact-policy.js";

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
    const normalized = normalizeArtifact(input);
    if (input.testRunId) {
      const testRun = await this.prisma.testRun.findFirst({
        where: { id: input.testRunId, releaseId: input.releaseId }
      });
      if (!testRun) {
        throw new Error("Test run does not belong to the release");
      }
    }
    const payload = toDatabasePayload(input, normalized);
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

function toDatabasePayload(input: ArtifactInput, normalized: ReturnType<typeof normalizeArtifact>) {
  if (typeof normalized.content !== "string") {
    return {
      binaryContent: Uint8Array.from(normalized.content),
      jsonContent: undefined,
      sizeBytes: normalized.sizeBytes,
      textContent: undefined
    };
  }

  if (input.contentType === "application/json") {
    const jsonContent = JSON.parse(normalized.content);

    return {
      binaryContent: undefined,
      jsonContent: jsonContent === null ? Prisma.JsonNull : (jsonContent as Prisma.InputJsonValue),
      sizeBytes: normalized.sizeBytes,
      textContent: undefined
    };
  }

  return {
    binaryContent: undefined,
    jsonContent: undefined,
    sizeBytes: normalized.sizeBytes,
    textContent: normalized.content
  };
}
