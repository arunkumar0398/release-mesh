import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "../generated/prisma/client.js";
import { RiskAssessmentRepository } from "./risk-assessment-repository.js";

const prisma = new PrismaClient();
const repository = new RiskAssessmentRepository(prisma);

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("RiskAssessmentRepository", () => {
  it("upserts one durable assessment per release", async () => {
    const release = await createRelease();

    await repository.upsert({
      assessment: {
        blastRadius: [],
        compatibleRemediation: "Add compatibility aliases.",
        confidence: "HIGH",
        evidenceLinks: [],
        rootCause: "Deterministic gate BLOCKED.",
        source: "deterministic/rule-based",
        uncertainty: "AI is unavailable.",
        verificationSteps: ["Run mandatory tests."]
      },
      releaseId: release.id,
      status: "AI_UNAVAILABLE"
    });
    await repository.upsert({
      assessment: {
        blastRadius: ["checkout"],
        compatibleRemediation: "Add price and currency aliases.",
        confidence: "HIGH",
        evidenceLinks: [],
        rootCause: "Pricing fields changed.",
        source: "GPT-5.6",
        uncertainty: "Registered consumers only.",
        verificationSteps: ["Run mandatory tests."]
      },
      releaseId: release.id,
      status: "AVAILABLE"
    });

    await expect(repository.findByReleaseId(release.id)).resolves.toMatchObject({
      assessment: expect.objectContaining({ source: "GPT-5.6" }),
      releaseId: release.id,
      status: "AVAILABLE"
    });
    await expect(prisma.riskAssessment.count({ where: { releaseId: release.id } })).resolves.toBe(1);
  });

  it("loads only analysis-safe artifact content and screenshot metadata", async () => {
    const release = await createRelease();
    const testRun = await prisma.testRun.create({
      data: { attempt: 0, releaseId: release.id, status: "FAILED", testId: "browser-checkout" }
    });
    await prisma.evidenceArtifact.create({
      data: {
        binaryContent: new Uint8Array([1, 2, 3, 4]),
        contentType: "image/png",
        kind: "SCREENSHOT",
        releaseId: release.id,
        sizeBytes: 4,
        storageKind: "POSTGRES",
        testRunId: testRun.id
      }
    });

    const evidence = await repository.loadEvidence({ attempt: 0, releaseId: release.id });

    expect(evidence).toEqual([
      expect.objectContaining({
        contentType: "image/png",
        kind: "SCREENSHOT",
        sizeBytes: 4,
        testRun: { status: "FAILED", testId: "browser-checkout" }
      })
    ]);
    expect(JSON.stringify(evidence)).not.toContain("binaryContent");
  });
});

async function createRelease() {
  const component = await prisma.component.create({
    data: { kind: "FIXTURE", name: `pricing-risk-${crypto.randomUUID()}`, ownerTeam: "pricing-platform" }
  });
  const version = await prisma.componentVersion.create({
    data: { componentId: component.id, version: "v2" }
  });
  return prisma.releaseCandidate.create({
    data: { componentVersionId: version.id, idempotencyKey: crypto.randomUUID(), status: "ANALYZING" }
  });
}
