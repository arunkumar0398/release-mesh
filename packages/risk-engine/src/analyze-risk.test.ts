import { describe, expect, it, vi } from "vitest";

import { analyzeRisk } from "./analyze-risk.js";
import type { RiskIntelligenceClient } from "./client.js";
import type { RiskEvidenceInput } from "./sanitize-evidence.js";

function createEvidence(): RiskEvidenceInput {
  return {
    apiAssertions: {
      artifactId: "api-artifact",
      result: { log: "Authorization: Bearer api-secret", outcome: "failed" }
    },
    browser: {
      artifactId: "browser-artifact",
      screenshot: { contentType: "image/png", sizeBytes: 1024 },
      summary: "Checkout rendered a pricing error."
    },
    contractDiff: {
      artifactId: "contract-artifact",
      result: { compatible: false, removedFields: ["price", "currency"] }
    },
    deterministicGate: "BLOCKED",
    ownership: [{ component: "checkout", ownerTeam: "checkout-platform" }],
    releaseId: "release-123",
    sanitizedLogs: []
  };
}

const validAnalysis = {
  blastRadius: ["Checkout cannot read Pricing v2."],
  compatibleRemediation: "Add price and currency compatibility aliases.",
  confidence: "HIGH",
  evidenceLinks: [{ artifactId: "contract-artifact", explanation: "Required fields were removed." }],
  rootCause: "Pricing v2 renamed fields required by Checkout.",
  uncertainty: "Only registered consumers were evaluated.",
  verificationSteps: ["Run all mandatory trusted tests."]
};

describe("analyzeRisk", () => {
  it("returns an explicitly deterministic/rule-based fallback when no key configured a client", async () => {
    const evidence = createEvidence();

    await expect(analyzeRisk({ client: null, evidence })).resolves.toMatchObject({
      assessment: {
        compatibleRemediation: expect.stringContaining("compatibility aliases"),
        rootCause: expect.stringContaining("Deterministic gate BLOCKED")
      },
      source: "deterministic/rule-based",
      status: "AI_UNAVAILABLE"
    });
    expect(evidence.deterministicGate).toBe("BLOCKED");
  });

  it("does not report ownership as blast radius for a SAFE deterministic gate", async () => {
    const evidence = { ...createEvidence(), deterministicGate: "SAFE" as const };

    await expect(analyzeRisk({ client: null, evidence })).resolves.toMatchObject({
      assessment: { blastRadius: [] },
      source: "deterministic/rule-based",
      status: "AI_UNAVAILABLE"
    });
  });

  it.each([
    ["timeout", new Error("GPT request timed out")],
    ["transport", new Error("GPT request unavailable")]
  ])("falls back without changing the deterministic gate on %s", async (_scenario, failure) => {
    const client: RiskIntelligenceClient = { analyzeEvidence: vi.fn().mockRejectedValue(failure) };
    const evidence = createEvidence();

    const result = await analyzeRisk({ client, evidence });

    expect(result.status).toBe("AI_UNAVAILABLE");
    expect(result.source).toBe("deterministic/rule-based");
    expect(evidence.deterministicGate).toBe("BLOCKED");
  });

  it("rejects invalid GPT output and uses deterministic fallback", async () => {
    const client: RiskIntelligenceClient = {
      analyzeEvidence: vi.fn().mockResolvedValue({ ...validAnalysis, gate: "SAFE" })
    };

    await expect(analyzeRisk({ client, evidence: createEvidence() })).resolves.toMatchObject({
      source: "deterministic/rule-based",
      status: "AI_UNAVAILABLE"
    });
  });

  it("sends sanitized structured evidence and returns a validated GPT-5.6 explanation", async () => {
    const analyzeEvidence = vi.fn().mockResolvedValue(validAnalysis);
    const client: RiskIntelligenceClient = { analyzeEvidence };

    await expect(analyzeRisk({ client, evidence: createEvidence() })).resolves.toEqual({
      assessment: validAnalysis,
      source: "GPT-5.6",
      status: "AVAILABLE"
    });
    expect(JSON.stringify(analyzeEvidence.mock.calls[0]?.[0])).not.toContain("api-secret");
  });
});
