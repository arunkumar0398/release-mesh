import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "./generated/prisma/client.js";
import { CatalogRepository } from "./repositories/catalog-repository.js";
import { seedCatalog } from "./seed.js";

const prisma = new PrismaClient();
const catalog = new CatalogRepository(prisma);

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
});
afterAll(async () => prisma.$disconnect());

describe("seedCatalog", () => {
  it("is repeatable and exposes only the Checkout to Pricing dependency", async () => {
    await seedCatalog(prisma);
    await seedCatalog(prisma);

    await expect(catalog.listComponents()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "checkout" }),
        expect.objectContaining({ name: "pricing" })
      ])
    );
    await expect(catalog.listDependencies()).resolves.toEqual([
      expect.objectContaining({
        consumer: expect.objectContaining({ name: "checkout" }),
        provider: expect.objectContaining({ name: "pricing" }),
        requiredEndpoints: ["GET /pricing/:productId"]
      })
    ]);
  });
});
