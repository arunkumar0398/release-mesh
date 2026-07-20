import { PrismaClient } from "../generated/prisma/client.js";

export class CatalogRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public listComponents() {
    return this.prisma.component.findMany({ orderBy: { name: "asc" } });
  }

  public listDependencies() {
    return this.prisma.dependency.findMany({
      include: { consumer: true, provider: true },
      orderBy: { id: "asc" }
    });
  }
}
