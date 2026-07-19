import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalArtifactStore } from "./local-artifact-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("LocalArtifactStore", () => {
  it("round-trips JSON evidence with artifact metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "releasemesh-artifacts-"));
    temporaryDirectories.push(directory);
    const store = new LocalArtifactStore(directory);

    const stored = await store.put({
      content: JSON.stringify({ breakingFields: ["price"] }),
      contentType: "application/json",
      kind: "CONTRACT_DIFF",
      releaseId: "release-123"
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({
      content: JSON.stringify({ breakingFields: ["price"] }),
      contentType: "application/json",
      id: stored.id,
      kind: "CONTRACT_DIFF",
      releaseId: "release-123"
    });
  });
});
