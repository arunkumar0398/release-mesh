import { PrismaClient } from "./generated/prisma/client.js";

export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const checkout = await transaction.component.upsert({
      create: { kind: "FRONTEND", name: "checkout", ownerTeam: "checkout-platform" },
      update: { kind: "FRONTEND", ownerTeam: "checkout-platform" },
      where: { name: "checkout" }
    });
    const pricing = await transaction.component.upsert({
      create: { kind: "FIXTURE", name: "pricing", ownerTeam: "pricing-platform" },
      update: { kind: "FIXTURE", ownerTeam: "pricing-platform" },
      where: { name: "pricing" }
    });

    await transaction.componentVersion.upsert({
      create: { componentId: pricing.id, version: "1.0.0" },
      update: {},
      where: { componentId_version: { componentId: pricing.id, version: "1.0.0" } }
    });
    await transaction.contract.upsert({
      create: {
        endpoint: "GET /pricing/:productId",
        providerId: pricing.id,
        schema: { currency: "INR", price: 1299 },
        version: "1.0.0"
      },
      update: { schema: { currency: "INR", price: 1299 } },
      where: {
        providerId_version_endpoint: {
          endpoint: "GET /pricing/:productId",
          providerId: pricing.id,
          version: "1.0.0"
        }
      }
    });
    await transaction.dependency.upsert({
      create: {
        consumerId: checkout.id,
        expectedContractVersion: "1.0.0",
        owningTeam: "checkout-platform",
        providerId: pricing.id,
        requiredEndpoints: ["GET /pricing/:productId"]
      },
      update: {
        expectedContractVersion: "1.0.0",
        owningTeam: "checkout-platform",
        requiredEndpoints: ["GET /pricing/:productId"]
      },
      where: { consumerId_providerId: { consumerId: checkout.id, providerId: pricing.id } }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  await seedCatalog(prisma);
  await prisma.$disconnect();
}
