import { randomUUID } from "node:crypto";

import {
  analyzeRisk,
  planReleaseTests,
  type RiskIntelligenceClient
} from "../../packages/risk-engine/src/index.js";
import { PrismaClient } from "../../packages/database/src/generated/prisma/client.js";
import { PostgresArtifactStore } from "../../packages/database/src/artifacts/postgres-artifact-store.js";
import { ReleaseRepository } from "../../packages/database/src/repositories/release-repository.js";
import { RiskAssessmentRepository } from "../../packages/database/src/repositories/risk-assessment-repository.js";
import { TestRunRepository } from "../../packages/database/src/repositories/test-run-repository.js";
import { ReleaseProcessor } from "../../services/runner-worker/src/release-processor.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = new PrismaClient();

beforeAll(async () => prisma.$connect());
beforeEach(async () => {
  await prisma.releaseCandidate.deleteMany();
  await prisma.componentVersion.deleteMany();
  await prisma.component.deleteMany();
});
afterAll(async () => prisma.$disconnect());

describe("AI fallback persistence", () => {
  it.each([
    ["no key", null],
    ["timeout", { analyzeEvidence: vi.fn().mockRejectedValue(new Error("timeout")) }],
    ["invalid output", { analyzeEvidence: vi.fn().mockResolvedValue({ gate: "SAFE" }) }]
  ] as const)("persists AI_UNAVAILABLE for %s without changing BLOCKED", async (_scenario, client) => {
    const release = await createQueuedRelease();
    const riskAssessmentRepository = new RiskAssessmentRepository(prisma);
    const processor = new ReleaseProcessor({
      artifactStore: new PostgresArtifactStore(prisma),
      mandatoryCheckExecutor: {
        runMandatoryChecks: vi.fn().mockResolvedValue([
          {
            artifact: {
              content: JSON.stringify({ compatible: false, removedFields: ["price", "currency"] }),
              contentType: "application/json",
              kind: "CONTRACT_DIFF"
            },
            hasIncompatibleRegisteredDependency: true,
            status: "FAILED",
            testId: "contract-pricing"
          },
          {
            artifact: {
              content: JSON.stringify({ missingFields: ["price", "currency"], outcome: "failed" }),
              contentType: "text/plain",
              kind: "SANITIZED_LOG"
            },
            hasIncompatibleRegisteredDependency: false,
            status: "FAILED",
            testId: "api-pricing"
          },
          {
            artifact: {
              content: new Uint8Array([137, 80, 78, 71]),
              contentType: "image/png",
              kind: "SCREENSHOT"
            },
            hasIncompatibleRegisteredDependency: false,
            status: "FAILED",
            testId: "browser-checkout"
          }
        ])
      },
      releaseRepository: new ReleaseRepository(prisma),
      riskAnalyzer: {
        analyze: (evidence) => analyzeRisk({
          client: client as RiskIntelligenceClient | null,
          evidence
        })
      },
      riskAssessmentRepository,
      riskPlanner: {
        plan: async (input) => (await planReleaseTests({ client: null, input })).selectedTestIds
      },
      testRunRepository: new TestRunRepository(prisma)
    });

    await expect(processor.process(release.id, 0)).resolves.toEqual({ gate: "BLOCKED" });
    await expect(prisma.releaseCandidate.findUniqueOrThrow({ where: { id: release.id } }))
      .resolves.toMatchObject({ status: "BLOCKED" });
    await expect(riskAssessmentRepository.findByReleaseId(release.id)).resolves.toMatchObject({
      assessment: expect.objectContaining({ source: "deterministic/rule-based" }),
      status: "AI_UNAVAILABLE"
    });
  });
});

async function createQueuedRelease() {
  const releaseRepository = new ReleaseRepository(prisma);
  const component = await prisma.component.create({
    data: { kind: "FIXTURE", name: "pricing", ownerTeam: "pricing-platform" }
  });
  const version = await prisma.componentVersion.create({
    data: { componentId: component.id, version: "v2" }
  });
  const created = await releaseRepository.createQueuedRelease({
    componentVersionId: version.id,
    correlationId: "ai-fallback",
    idempotencyKey: randomUUID()
  });
  return created.release;
}
