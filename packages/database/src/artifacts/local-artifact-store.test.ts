import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("applies log redaction and artifact policy before writing locally", async () => {
    const directory = await mkdtemp(join(tmpdir(), "releasemesh-artifacts-"));
    temporaryDirectories.push(directory);
    const store = new LocalArtifactStore(directory);
    const stored = await store.put({
      content: 'Authorization="Bearer secret"\n{"token":"secret-token"}',
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: "release-123"
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({
      content: 'Authorization=[REDACTED]\n{"token":"[REDACTED]"}'
    });
    expect(stored.sizeBytes).toBe(Buffer.byteLength('Authorization=[REDACTED]\n{"token":"[REDACTED]"}'));
    await expect(
      store.put({
        content: new Uint8Array([1]),
        contentType: "text/plain",
        kind: "SANITIZED_LOG",
        releaseId: "release-123"
      } as unknown as Parameters<typeof store.put>[0])
    ).rejects.toThrow("Unsupported artifact content representation");
  });

  it.each([
    ["Redis URL", "REDIS_URL=redis://:redis-password@host:6379", "REDIS_URL=[REDACTED]"],
    [
      "URI userinfo",
      "Connecting to https://demo:password@example.com/private",
      "Connecting to https://[REDACTED]@example.com/private"
    ],
    ["cookie header", "Cookie: session=browser-secret", "Cookie: [REDACTED]"],
    ["AWS access key", "AWS_ACCESS_KEY_ID=AKIAEXAMPLE", "AWS_ACCESS_KEY_ID=[REDACTED]"],
    [
      "mixed JSON and env values",
      '{"REDIS_URL":"redis://user:secret@host:6379","AZURE_CLIENT_SECRET":"cloud-secret"}\nGOOGLE_API_KEY=google-secret',
      '{"REDIS_URL":"[REDACTED]","AZURE_CLIENT_SECRET":"[REDACTED]"}\nGOOGLE_API_KEY=[REDACTED]'
    ]
  ])("sanitizes %s values", async (_scenario, content, expected) => {
    const directory = await mkdtemp(join(tmpdir(), "releasemesh-artifacts-"));
    temporaryDirectories.push(directory);
    const store = new LocalArtifactStore(directory);
    const stored = await store.put({
      content,
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: "release-123"
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({ content: expected });
  });

  it("does not read paths outside the artifact root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "releasemesh-artifacts-"));
    temporaryDirectories.push(directory);
    const store = new LocalArtifactStore(directory);

    await expect(store.get("../../outside")).resolves.toBeNull();
  });

  it("rejects tampered metadata that points outside the artifact root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "releasemesh-artifacts-"));
    temporaryDirectories.push(directory);
    const store = new LocalArtifactStore(directory);
    const stored = await store.put({
      content: JSON.stringify({ compatible: true }),
      contentType: "application/json",
      kind: "CONTRACT_DIFF",
      releaseId: "release-123"
    });
    const metadataPath = join(directory, `${stored.id}.metadata.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { contentPath: string };
    metadata.contentPath = "../outside.content";
    await writeFile(metadataPath, JSON.stringify(metadata));

    await expect(store.get(stored.id)).rejects.toThrow("Artifact path is outside the configured root");
  });
});
