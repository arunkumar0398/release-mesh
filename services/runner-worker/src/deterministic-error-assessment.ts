export function buildDeterministicErrorAssessment(errorCode: string): Record<string, unknown> {
  return {
    blastRadius: [],
    compatibleRemediation: errorCode === "ARTIFACT_STORAGE_FAILED"
      ? "Restore PostgreSQL artifact persistence, then retry every mandatory trusted check."
      : "Restore the failed runtime dependency, then retry every mandatory trusted check.",
    confidence: "HIGH",
    evidenceLinks: [],
    rootCause: `Release entered deterministic ERROR after ${errorCode}.`,
    source: "deterministic/rule-based",
    uncertainty: "Required checks or durable evidence did not complete, so no release-safety inference is available.",
    verificationSteps: [
      "Restore the failed runtime dependency.",
      "Retry the release and rerun every mandatory trusted check."
    ]
  };
}
