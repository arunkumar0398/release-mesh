import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/prisma/client.js";
import { TestRunRepository } from "../repositories/test-run-repository.js";
import { PostgresArtifactStore } from "./postgres-artifact-store.js";

const prisma = new PrismaClient();
const store = new PostgresArtifactStore(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await prisma.releaseTransition.deleteMany();
  await prisma.evidenceArtifact.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PostgresArtifactStore", () => {
  it("round-trips sanitized JSON evidence for a release", async () => {
    const release = await createRelease();

    const stored = await store.put({
      content: JSON.stringify({ endpoint: "/pricing/sku-123", sanitized: true }),
      contentType: "application/json",
      kind: "CONTRACT_DIFF",
      releaseId: release.id
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({
      content: JSON.stringify({ endpoint: "/pricing/sku-123", sanitized: true }),
      contentType: "application/json",
      id: stored.id,
      releaseId: release.id
    });
  });

  it.each(["false", "0", "null", "[]", "{\"price\":1299}"])(
    "round-trips primitive and structured JSON evidence %s",
    async (content) => {
      const release = await createRelease();
      const stored = await store.put({
        content,
        contentType: "application/json",
        kind: "CONTRACT_DIFF",
        releaseId: release.id
      });

      await expect(store.get(stored.id)).resolves.toMatchObject({ content });
    }
  );

  it("sanitizes sensitive values from persisted logs", async () => {
    const release = await createRelease();
    const stored = await store.put({
      content: "Authorization: Bearer super-secret-token\nDATABASE_URL=postgres://user:password@host/database",
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: release.id
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({
      content: "Authorization: [REDACTED]\nDATABASE_URL=[REDACTED]"
    });
  });

  it("redacts authorization schemes and secret key-value formats before persisting logs", async () => {
    const release = await createRelease();
    const stored = await store.put({
      content: [
        "Authorization: Basic dXNlcjpwYXNzd29yZA==",
        '{"apiKey":"api-secret","password":"db-password","token":"token-secret","secret":"shared-secret"}',
        "DATABASE_URL: postgres://user:password@host/database"
      ].join("\n"),
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: release.id
    });
    const artifact = await store.get(stored.id);

    expect(artifact?.content).toBe(
      [
        "Authorization: [REDACTED]",
        '{"apiKey":"[REDACTED]","password":"[REDACTED]","token":"[REDACTED]","secret":"[REDACTED]"}',
        "DATABASE_URL: [REDACTED]"
      ].join("\n")
    );
    expect(stored.sizeBytes).toBe(Buffer.byteLength(artifact?.content as string));
  });

  it("redacts JSON-formatted and equals-style authorization values", async () => {
    const release = await createRelease();
    const stored = await store.put({
      content: '{"authorization":"Bearer json-secret"}\nAuthorization=Basic encoded-secret',
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: release.id
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({
      content: '{"authorization":[REDACTED]}\nAuthorization=[REDACTED]'
    });
  });

  it("round-trips a small PNG screenshot", async () => {
    const release = await createRelease();
    const content = new Uint8Array([137, 80, 78, 71]);
    const stored = await store.put({
      content,
      contentType: "image/png",
      kind: "SCREENSHOT",
      releaseId: release.id
    });

    await expect(store.get(stored.id)).resolves.toMatchObject({ content });
  });

  it("rejects unsupported content and oversized screenshots", async () => {
    const release = await createRelease();

    await expect(
      store.put({
        content: "<html></html>",
        contentType: "text/html",
        kind: "SANITIZED_LOG",
        releaseId: release.id
      } as unknown as Parameters<typeof store.put>[0])
    ).rejects.toThrow("Unsupported artifact content type");

    await expect(
      store.put({
        content: new Uint8Array(1_048_577),
        contentType: "image/png",
        kind: "SCREENSHOT",
        releaseId: release.id
      })
    ).rejects.toThrow("Artifact exceeds the size limit");
  });

  it("rejects artifact content representations that could bypass storage policy", async () => {
    const release = await createRelease();

    await expect(
      store.put({
        content: new Uint8Array([1]),
        contentType: "text/plain",
        kind: "SANITIZED_LOG",
        releaseId: release.id
      } as unknown as Parameters<typeof store.put>[0])
    ).rejects.toThrow("Unsupported artifact content representation");

    await expect(
      store.put({
        content: new Uint8Array([1]),
        contentType: "application/json",
        kind: "CONTRACT_DIFF",
        releaseId: release.id
      } as unknown as Parameters<typeof store.put>[0])
    ).rejects.toThrow("Unsupported artifact content representation");

    await expect(
      store.put({
        content: "not image bytes",
        contentType: "image/png",
        kind: "SCREENSHOT",
        releaseId: release.id
      } as unknown as Parameters<typeof store.put>[0])
    ).rejects.toThrow("Unsupported artifact content representation");
  });

  it("rejects an artifact test run owned by a different release", async () => {
    const firstRelease = await createRelease();
    const secondRelease = await createRelease("pricing-artifact-second", "artifact-store-release-second");
    const testRun = await prisma.testRun.create({
      data: { attempt: 0, releaseId: firstRelease.id, status: "PASSED", testId: "contract-check" }
    });

    await expect(
      store.put({
        content: JSON.stringify({ compatible: true }),
        contentType: "application/json",
        kind: "CONTRACT_DIFF",
        releaseId: secondRelease.id,
        testRunId: testRun.id
      })
    ).rejects.toThrow("Test run does not belong to the release");
  });

  it("restarts a test within the same release attempt without duplicating stale evidence", async () => {
    const release = await createRelease();
    const repository = new TestRunRepository(prisma);
    const firstRun = await repository.start({ attempt: 0, releaseId: release.id, testId: "api-pricing" });
    await store.put({
      content: "first run",
      contentType: "text/plain",
      kind: "SANITIZED_LOG",
      releaseId: release.id,
      testRunId: firstRun.id
    });

    const restarted = await repository.start({ attempt: 0, releaseId: release.id, testId: "api-pricing" });

    expect(restarted.id).toBe(firstRun.id);
    await expect(prisma.evidenceArtifact.count({ where: { testRunId: restarted.id } })).resolves.toBe(0);
  });
});

async function createRelease(componentName = "pricing-artifact", idempotencyKey = "artifact-store-release") {
  const component = await prisma.component.create({
    data: { kind: "FIXTURE", name: componentName, ownerTeam: "checkout-platform" }
  });
  const version = await prisma.componentVersion.create({
    data: { componentId: component.id, version: "1.0.0" }
  });

  return prisma.releaseCandidate.create({
    data: { componentVersionId: version.id, idempotencyKey }
  });
}
