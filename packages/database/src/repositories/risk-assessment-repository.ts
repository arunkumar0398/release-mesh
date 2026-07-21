import { Prisma, PrismaClient } from "../generated/prisma/client.js";

export type RiskAssessmentStatus = "AI_UNAVAILABLE" | "AVAILABLE";

export interface PersistRiskAssessmentInput {
  assessment: Record<string, unknown>;
  releaseId: string;
  status: RiskAssessmentStatus;
}

export class RiskAssessmentRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public findByReleaseId(releaseId: string) {
    return this.prisma.riskAssessment.findUnique({ where: { releaseId } });
  }

  public loadEvidence(input: { attempt: number; releaseId: string }) {
    return this.prisma.evidenceArtifact.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        contentType: true,
        id: true,
        jsonContent: true,
        kind: true,
        sizeBytes: true,
        testRun: { select: { status: true, testId: true } },
        textContent: true
      },
      where: {
        releaseId: input.releaseId,
        testRun: { attempt: input.attempt }
      }
    });
  }

  public upsert(input: PersistRiskAssessmentInput): Promise<unknown> {
    return this.prisma.riskAssessment.upsert({
      create: {
        ...input,
        assessment: input.assessment as Prisma.InputJsonObject
      },
      update: {
        assessment: input.assessment as Prisma.InputJsonObject,
        status: input.status
      },
      where: { releaseId: input.releaseId }
    });
  }
}
