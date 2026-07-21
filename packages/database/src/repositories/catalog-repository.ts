import { PrismaClient } from "../generated/prisma/client.js";

export class CatalogRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public findComponentById(componentId: string) {
    return this.prisma.component.findUnique({
      include: {
        providedContracts: true,
        providedDependencies: { include: { consumer: true } },
        versions: { orderBy: { createdAt: "asc" } }
      },
      where: { id: componentId }
    });
  }

  public listComponents() {
    return this.prisma.component.findMany({ orderBy: { name: "asc" } });
  }

  public listDependencies() {
    return this.prisma.dependency.findMany({
      include: { consumer: true, provider: true },
      orderBy: { id: "asc" }
    });
  }

  public findComponentVersion(componentName: string, version: string) {
    return this.prisma.componentVersion.findFirst({
      include: { component: true },
      where: {
        component: { name: componentName },
        version
      }
    });
  }
}
