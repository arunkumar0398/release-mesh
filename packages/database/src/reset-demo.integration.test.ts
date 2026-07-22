import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ArtifactStorageKind, PrismaClient } from "./generated/prisma/client.js";
import { resetDemo } from "./reset-demo.js";
import { seedCatalog } from "./seed.js";

const prisma = new PrismaClient();

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.evidenceArtifact.deleteMany();
  await prisma.riskAssessment.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.releaseTransition.deleteMany();
  await prisma.releaseCandidate.deleteMany();
  await prisma.dependency.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
  await prisma.workerHeartbeat.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("resetDemo", () => {
  it("transactionally clears releases and restores only the seeded catalogue", async () => {
    await seedCatalog(prisma);
    const version = await prisma.componentVersion.findFirstOrThrow({
      where: { component: { name: "pricing" }, version: "v2" }
    });
    const release = await prisma.releaseCandidate.create({
      data: { componentVersionId: version.id, idempotencyKey: "reset-demo-release" }
    });
    const testRun = await prisma.testRun.create({
      data: { attempt: 0, releaseId: release.id, status: "FAILED", testId: "contract-pricing" }
    });
    await prisma.evidenceArtifact.create({
      data: {
        contentType: "application/json",
        jsonContent: { compatible: false },
        kind: "CONTRACT_DIFF",
        releaseId: release.id,
        sizeBytes: 20,
        storageKind: ArtifactStorageKind.POSTGRES,
        testRunId: testRun.id
      }
    });
    await prisma.component.create({
      data: { kind: "BACKEND", name: "out-of-scope", ownerTeam: "not-seeded" }
    });
    await prisma.workerHeartbeat.create({ data: { workerId: "runner-1" } });

    await resetDemo(prisma);
    await resetDemo(prisma);

    await expect(prisma.releaseCandidate.count()).resolves.toBe(0);
    await expect(prisma.evidenceArtifact.count()).resolves.toBe(0);
    await expect(prisma.component.findMany({
      orderBy: { name: "asc" },
      select: { name: true }
    })).resolves.toEqual([{ name: "checkout" }, { name: "pricing" }]);
    await expect(prisma.componentVersion.findMany({
      orderBy: { version: "asc" },
      select: { version: true }
    })).resolves.toEqual([
      { version: "1.0.0" },
      { version: "v2" },
      { version: "v2.1" }
    ]);
    await expect(prisma.dependency.count()).resolves.toBe(1);
    await expect(prisma.workerHeartbeat.count()).resolves.toBe(1);
  });
});
