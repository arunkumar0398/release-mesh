import { PrismaClient } from "../generated/prisma/client.js";

export class TestRunRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async prepareAttempt(input: { attempt: number; releaseId: string }): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const testRuns = await transaction.testRun.findMany({
        select: { id: true },
        where: { attempt: input.attempt, releaseId: input.releaseId }
      });
      const testRunIds = testRuns.map(({ id }) => id);
      if (testRunIds.length > 0) {
        await transaction.evidenceArtifact.deleteMany({ where: { testRunId: { in: testRunIds } } });
        await transaction.testRun.deleteMany({ where: { id: { in: testRunIds } } });
      }
    });
  }

  public async loadAttemptSummary(input: { attempt: number; releaseId: string }) {
    const testRuns = await this.prisma.testRun.findMany({
      include: { artifacts: true },
      where: { attempt: input.attempt, releaseId: input.releaseId }
    });
    return testRuns.map((testRun) => {
      const hasValidStatus = testRun.status === "PASSED" || testRun.status === "FAILED";
      return {
      hasArtifact: testRun.artifacts.length > 0 && hasValidStatus,
      hasIncompatibleRegisteredDependency: testRun.artifacts.some((artifact) =>
        artifact.kind === "CONTRACT_DIFF"
        && typeof artifact.jsonContent === "object"
        && artifact.jsonContent !== null
        && !Array.isArray(artifact.jsonContent)
        && (artifact.jsonContent as Record<string, unknown>).compatible === false
      ),
      status: (hasValidStatus ? testRun.status : "FAILED") as "FAILED" | "PASSED",
      testId: testRun.testId
    };
    });
  }

  public start(input: { attempt: number; releaseId: string; testId: string }) {
    return this.prisma.$transaction(async (transaction) => {
      const key = {
        attempt: input.attempt,
        releaseId: input.releaseId,
        testId: input.testId
      };
      const existing = await transaction.testRun.findUnique({
        where: { releaseId_attempt_testId: key }
      });
      if (existing) {
        await transaction.evidenceArtifact.deleteMany({ where: { testRunId: existing.id } });
        return transaction.testRun.update({
          data: { endedAt: null, startedAt: new Date(), status: "RUNNING" },
          where: { id: existing.id }
        });
      }
      return transaction.testRun.create({
        data: { ...key, startedAt: new Date(), status: "RUNNING" }
      });
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
