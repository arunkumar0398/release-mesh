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
