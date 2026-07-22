import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ArtifactStorageKind, PrismaClient } from "../generated/prisma/client.js";
import { LocalArtifactStore } from "./local-artifact-store.js";

const prisma = new PrismaClient();
const temporaryDirectories: string[] = [];

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.evidenceArtifact.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.releaseTransition.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true
  })));
});

describe("LocalArtifactStore database metadata", () => {
  it("persists durable evidence content without exposing an absolute local path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "releasemesh-local-db-artifacts-"));
    temporaryDirectories.push(directory);
    const component = await prisma.component.create({
      data: { kind: "FIXTURE", name: "pricing", ownerTeam: "pricing-platform" }
    });
    const version = await prisma.componentVersion.create({
      data: { componentId: component.id, version: "v2" }
    });
    const release = await prisma.releaseCandidate.create({
      data: { componentVersionId: version.id, idempotencyKey: "local-artifact-release" }
    });
    const testRun = await prisma.testRun.create({
      data: { attempt: 0, releaseId: release.id, status: "RUNNING", testId: "contract-pricing" }
    });
    const store = new LocalArtifactStore({ prisma, rootDirectory: directory });

    await store.put({
      content: JSON.stringify({ compatible: false }),
      contentType: "application/json",
      kind: "CONTRACT_DIFF",
      releaseId: release.id,
      testRunId: testRun.id
    });
    await store.put({
      content: "Authorization: Bearer local-secret",
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: release.id,
      testRunId: testRun.id
    });
    await store.put({
      content: new Uint8Array([137, 80, 78, 71]),
      contentType: "image/png",
      kind: "SCREENSHOT",
      releaseId: release.id,
      testRunId: testRun.id
    });

    const artifacts = await prisma.evidenceArtifact.findMany({ orderBy: { kind: "asc" } });
    expect(artifacts).toHaveLength(3);
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jsonContent: { compatible: false },
        kind: "CONTRACT_DIFF",
        storageKind: ArtifactStorageKind.LOCAL
      }),
      expect.objectContaining({
        kind: "SANITIZED_LOG",
        storageKind: ArtifactStorageKind.LOCAL,
        textContent: "Authorization: [REDACTED]"
      }),
      expect.objectContaining({
        binaryContent: Uint8Array.from([137, 80, 78, 71]),
        kind: "SCREENSHOT",
        storageKind: ArtifactStorageKind.LOCAL
      })
    ]));
    expect(artifacts.every(({ localPath }) => localPath !== null && !localPath.includes(directory))).toBe(true);
  });
});
