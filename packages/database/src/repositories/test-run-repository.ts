import { PrismaClient } from "../generated/prisma/client.js";

export class TestRunRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public start(input: { releaseId: string; testId: string }) {
    return this.prisma.testRun.create({
      data: {
        releaseId: input.releaseId,
        startedAt: new Date(),
        status: "RUNNING",
        testId: input.testId
      }
    });
  }

  public async complete(input: {
    status: "ERROR" | "FAILED" | "PASSED";
    testRunId: string;
  }): Promise<void> {
    await this.prisma.testRun.update({
      data: { endedAt: new Date(), status: input.status },
      where: { id: input.testRunId }
    });
  }
}
