import type {
  ArtifactInput,
  ArtifactStore,
  RetrievedArtifact,
  StoredArtifact
} from "@releasemesh/contracts";

import { ArtifactStorageKind, Prisma, PrismaClient } from "../generated/prisma/client.js";

export class PostgresArtifactStore implements ArtifactStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async get(id: string): Promise<RetrievedArtifact | null> {
    const artifact = await this.prisma.evidenceArtifact.findUnique({ where: { id } });

    if (!artifact) {
      return null;
    }

    return {
      content: artifact.jsonContent
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
    return {
      binaryContent: undefined,
      jsonContent: JSON.parse(input.content) as Prisma.InputJsonValue,
      sizeBytes: Buffer.byteLength(input.content),
      textContent: undefined
    };
  }

  return {
    binaryContent: undefined,
    jsonContent: undefined,
    sizeBytes: Buffer.byteLength(input.content),
    textContent: input.content
  };
}
