import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { seedCatalogData } from "./seed.js";

export async function resetDemo(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.evidenceArtifact.deleteMany();
    await transaction.riskAssessment.deleteMany();
    await transaction.testRun.deleteMany();
    await transaction.releaseTransition.deleteMany();
    await transaction.releaseCandidate.deleteMany();
    await transaction.dependency.deleteMany();
    await transaction.contract.deleteMany();
    await transaction.componentVersion.deleteMany();
    await transaction.component.deleteMany();
    await seedCatalogData(transaction);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  try {
    await resetDemo(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
