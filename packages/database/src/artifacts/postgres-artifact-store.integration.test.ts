import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/prisma/client.js";
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
      content: "Authorization: Bearer [REDACTED]\nDATABASE_URL=[REDACTED]"
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
      })
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
});

async function createRelease() {
  const component = await prisma.component.create({
    data: { kind: "FIXTURE", name: "pricing-artifact", ownerTeam: "checkout-platform" }
  });
  const version = await prisma.componentVersion.create({
    data: { componentId: component.id, version: "1.0.0" }
  });

  return prisma.releaseCandidate.create({
    data: { componentVersionId: version.id, idempotencyKey: "artifact-store-release" }
  });
}
