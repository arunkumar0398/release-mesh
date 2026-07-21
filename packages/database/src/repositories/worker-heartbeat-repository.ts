import { PrismaClient } from "../generated/prisma/client.js";

export class WorkerHeartbeatRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public findLatest() {
    return this.prisma.workerHeartbeat.findFirst({ orderBy: { seenAt: "desc" } });
  }

  public async record(workerId: string, seenAt = new Date()): Promise<void> {
    await this.prisma.workerHeartbeat.upsert({
      create: { seenAt, workerId },
      update: { seenAt },
      where: { workerId }
    });
  }
}
