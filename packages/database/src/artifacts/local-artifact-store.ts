import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type {
  ArtifactInput,
  ArtifactStore,
  RetrievedArtifact,
  StoredArtifact
} from "@releasemesh/contracts";

interface LocalArtifactMetadata extends StoredArtifact {
  contentEncoding: "binary" | "utf8";
  contentPath: string;
}

export class LocalArtifactStore implements ArtifactStore {
  public constructor(private readonly rootDirectory: string) {}

  public async get(id: string): Promise<RetrievedArtifact | null> {
    try {
      const metadata = JSON.parse(
        await readFile(join(this.rootDirectory, `${id}.metadata.json`), "utf8")
      ) as LocalArtifactMetadata;
      const content = await readFile(join(this.rootDirectory, metadata.contentPath));

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
    const content = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : input.content;
    const metadata: LocalArtifactMetadata = {
      contentEncoding: typeof input.content === "string" ? "utf8" : "binary",
      contentPath: `${id}.content`,
      contentType: input.contentType,
      id,
      kind: input.kind,
      releaseId: input.releaseId,
      sizeBytes: content.byteLength,
      testRunId: input.testRunId
    };

    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(join(this.rootDirectory, metadata.contentPath), content);
    await writeFile(join(this.rootDirectory, `${id}.metadata.json`), JSON.stringify(metadata));

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
