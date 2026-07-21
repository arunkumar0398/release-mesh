import type { DeterministicReleaseGate } from "@releasemesh/contracts";

import { parseAnalysisOutput, type RiskAnalysisOutput } from "./analysis-schema.js";
import type { RiskIntelligenceClient } from "./client.js";
import {
  sanitizeEvidence,
  type RiskEvidenceInput,
  type SanitizedRiskEvidence
} from "./sanitize-evidence.js";

export type RiskAnalysisResult =
  | { assessment: RiskAnalysisOutput; source: "GPT-5.6"; status: "AVAILABLE" }
  | {
      assessment: RiskAnalysisOutput;
      source: "deterministic/rule-based";
      status: "AI_UNAVAILABLE";
    };

export async function analyzeRisk({
  client,
  evidence
}: {
  client: RiskIntelligenceClient | null;
  evidence: RiskEvidenceInput;
}): Promise<RiskAnalysisResult> {
  const sanitizedEvidence = sanitizeEvidence(evidence);
  if (client === null) return deterministicFallback(sanitizedEvidence);

  try {
    const output = await client.analyzeEvidence(sanitizedEvidence);
    return {
      assessment: parseAnalysisOutput(output, collectArtifactIds(sanitizedEvidence)),
      source: "GPT-5.6",
      status: "AVAILABLE"
    };
  } catch {
    return deterministicFallback(sanitizedEvidence);
  }
}

function deterministicFallback(evidence: SanitizedRiskEvidence): RiskAnalysisResult {
  return {
    assessment: {
      blastRadius: evidence.deterministicGate === "SAFE"
        ? []
        : evidence.ownership.map(
            ({ component, ownerTeam }) => `${component} owned by ${ownerTeam}`
          ),
      compatibleRemediation: remediationFor(evidence.deterministicGate),
      confidence: "HIGH",
      evidenceLinks: collectArtifactIds(evidence).map((artifactId) => ({
        artifactId,
        explanation: "Persisted evidence from a mandatory trusted check."
      })),
      rootCause: `Deterministic gate ${evidence.deterministicGate} was computed from mandatory trusted checks; GPT-5.6 analysis is unavailable.`,
      uncertainty: "This deterministic/rule-based explanation does not add AI interpretation; inspect the persisted evidence for details.",
      verificationSteps: [
        "Review every persisted mandatory-test result and evidence artifact.",
        "Rerun all mandatory trusted tests after any compatibility change."
      ]
    },
    source: "deterministic/rule-based",
    status: "AI_UNAVAILABLE"
  };
}

function collectArtifactIds(evidence: SanitizedRiskEvidence): string[] {
  return [...new Set([
    evidence.contractDiff?.artifactId,
    evidence.apiAssertions?.artifactId,
    evidence.browser?.artifactId,
    ...evidence.sanitizedLogs.map(({ artifactId }) => artifactId)
  ].filter((artifactId): artifactId is string => artifactId !== undefined))];
}

function remediationFor(gate: DeterministicReleaseGate): string {
  if (gate === "BLOCKED") {
    return "Restore the required Pricing fields or add compatibility aliases, then rerun every mandatory test.";
  }
  if (gate === "ERROR") {
    return "Restore the missing checks or evidence and retry; do not infer release safety from an incomplete run.";
  }
  return "No compatibility remediation is required; retain every mandatory test for future releases.";
}
