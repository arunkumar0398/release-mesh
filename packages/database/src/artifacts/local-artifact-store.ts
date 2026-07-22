import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  ArtifactInput,
  ArtifactStore,
  RetrievedArtifact,
  StoredArtifact
} from "@releasemesh/contracts";
import { ArtifactStorageKind, type PrismaClient } from "../generated/prisma/client.js";
import { normalizeArtifact } from "./artifact-policy.js";
import { toDatabaseArtifactPayload } from "./database-artifact-payload.js";

interface LocalArtifactMetadata extends StoredArtifact {
  contentEncoding: "binary" | "utf8";
  contentPath: string;
}

export class LocalArtifactStore implements ArtifactStore {
  private readonly prisma: PrismaClient | undefined;
  private readonly rootDirectory: string;

  public constructor(options: string | { prisma: PrismaClient; rootDirectory: string }) {
    this.rootDirectory = typeof options === "string" ? options : options.rootDirectory;
    this.prisma = typeof options === "string" ? undefined : options.prisma;
  }

  public async get(id: string): Promise<RetrievedArtifact | null> {
    if (!isArtifactId(id)) {
      return null;
    }

    try {
      const rootDirectory = resolve(this.rootDirectory);
      const metadata = JSON.parse(
        await readFile(resolveInside(rootDirectory, `${id}.metadata.json`), "utf8")
      ) as LocalArtifactMetadata;
      const content = await readFile(resolveInside(rootDirectory, metadata.contentPath));

      return {
        ...metadata,
        content: metadata.contentEncoding === "utf8" ? content.toString("utf8") : content
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  public async put(input: ArtifactInput): Promise<StoredArtifact> {
    const id = randomUUID();
    const normalized = normalizeArtifact(input);
    const content = typeof normalized.content === "string" ? Buffer.from(normalized.content, "utf8") : normalized.content;
    const metadata: LocalArtifactMetadata = {
      contentEncoding: typeof normalized.content === "string" ? "utf8" : "binary",
      contentPath: `${id}.content`,
      contentType: input.contentType,
      id,
      kind: input.kind,
      releaseId: input.releaseId,
      sizeBytes: normalized.sizeBytes,
      testRunId: input.testRunId
    };

    if (this.prisma && input.testRunId) {
      const testRun = await this.prisma.testRun.findFirst({
        where: { id: input.testRunId, releaseId: input.releaseId }
      });
      if (!testRun) throw new Error("Test run does not belong to the release");
    }

    await mkdir(this.rootDirectory, { recursive: true });
    const contentPath = join(this.rootDirectory, metadata.contentPath);
    const metadataPath = join(this.rootDirectory, `${id}.metadata.json`);
    try {
      await writeFile(contentPath, content);
      await writeFile(metadataPath, JSON.stringify(metadata));
      if (this.prisma) {
        const payload = toDatabaseArtifactPayload(input, normalized);
        await this.prisma.evidenceArtifact.create({
          data: {
            binaryContent: payload.binaryContent,
            contentType: input.contentType,
            id,
            jsonContent: payload.jsonContent,
            kind: input.kind,
            localPath: metadata.contentPath,
            releaseId: input.releaseId,
            sizeBytes: payload.sizeBytes,
            storageKind: ArtifactStorageKind.LOCAL,
            testRunId: input.testRunId,
            textContent: payload.textContent
          }
        });
      }
    } catch (error) {
      await Promise.all([
        rm(contentPath, { force: true }),
        rm(metadataPath, { force: true })
      ]);
      throw error;
    }

    return toStoredArtifact(metadata);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function toStoredArtifact(metadata: LocalArtifactMetadata): StoredArtifact {
  return {
    contentType: metadata.contentType,
    id: metadata.id,
    kind: metadata.kind,
    releaseId: metadata.releaseId,
    sizeBytes: metadata.sizeBytes,
    testRunId: metadata.testRunId
  };
}

function isArtifactId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function resolveInside(rootDirectory: string, path: string): string {
  const resolvedPath = resolve(rootDirectory, path);
  const relativePath = relative(rootDirectory, resolvedPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error("Artifact path is outside the configured root");
  }

  return resolvedPath;
}
