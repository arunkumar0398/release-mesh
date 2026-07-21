export type RiskConfidence = "HIGH" | "LOW" | "MEDIUM";

export interface RiskEvidenceLink {
  artifactId: string;
  explanation: string;
}

export interface RiskAnalysisOutput {
  blastRadius: string[];
  compatibleRemediation: string;
  confidence: RiskConfidence;
  evidenceLinks: RiskEvidenceLink[];
  rootCause: string;
  uncertainty: string;
  verificationSteps: string[];
}

const outputKeys = [
  "blastRadius",
  "compatibleRemediation",
  "confidence",
  "evidenceLinks",
  "rootCause",
  "uncertainty",
  "verificationSteps"
] as const;
const evidenceLinkKeys = ["artifactId", "explanation"] as const;

export const analysisOutputJsonSchema = {
  additionalProperties: false,
  properties: {
    blastRadius: boundedStringArraySchema(),
    compatibleRemediation: boundedStringSchema(),
    confidence: { enum: ["LOW", "MEDIUM", "HIGH"], type: "string" },
    evidenceLinks: {
      items: {
        additionalProperties: false,
        properties: {
          artifactId: boundedStringSchema(),
          explanation: boundedStringSchema()
        },
        required: ["artifactId", "explanation"],
        type: "object"
      },
      maxItems: 20,
      minItems: 1,
      type: "array"
    },
    rootCause: boundedStringSchema(),
    uncertainty: boundedStringSchema(),
    verificationSteps: { ...boundedStringArraySchema(), minItems: 1 }
  },
  required: [...outputKeys],
  type: "object"
} as const;

export function parseAnalysisOutput(
  value: unknown,
  evidenceArtifactIds: readonly string[]
): RiskAnalysisOutput {
  try {
    const output = requireRecord(value);
    requireExactKeys(output, outputKeys);
    const confidence = output.confidence;
    if (confidence !== "HIGH" && confidence !== "LOW" && confidence !== "MEDIUM") {
      throw new Error("confidence must be LOW, MEDIUM, or HIGH");
    }
    const trustedArtifactIds = new Set(evidenceArtifactIds);
    const linkedArtifactIds = new Set<string>();
    if (!Array.isArray(output.evidenceLinks) || output.evidenceLinks.length > 20) {
      throw new Error("evidenceLinks must be a bounded array");
    }
    if (trustedArtifactIds.size > 0 && output.evidenceLinks.length === 0) {
      throw new Error("evidenceLinks must ground the analysis in persisted evidence");
    }
    const evidenceLinks = output.evidenceLinks.map((value) => {
      const link = requireRecord(value);
      requireExactKeys(link, evidenceLinkKeys);
      const artifactId = requireBoundedString(link.artifactId);
      if (!trustedArtifactIds.has(artifactId) || linkedArtifactIds.has(artifactId)) {
        throw new Error("evidence link must reference unique persisted evidence");
      }
      linkedArtifactIds.add(artifactId);
      return {
        artifactId,
        explanation: requireBoundedString(link.explanation)
      };
    });
    const verificationSteps = requireStringArray(output.verificationSteps);
    if (verificationSteps.length === 0) throw new Error("verificationSteps cannot be empty");

    return {
      blastRadius: requireStringArray(output.blastRadius),
      compatibleRemediation: requireBoundedString(output.compatibleRemediation),
      confidence,
      evidenceLinks,
      rootCause: requireBoundedString(output.rootCause),
      uncertainty: requireBoundedString(output.uncertainty),
      verificationSteps
    };
  } catch (error) {
    throw new Error("Invalid GPT analysis output", { cause: error });
  }
}

function boundedStringSchema() {
  return { maxLength: 2_000, minLength: 1, type: "string" } as const;
}

function boundedStringArraySchema() {
  return {
    items: boundedStringSchema(),
    maxItems: 20,
    type: "array"
  } as const;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("value must be an object");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error("value has unexpected properties");
  }
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("value must be a bounded array");
  }
  return value.map(requireBoundedString);
}

function requireBoundedString(value: unknown): string {
  if (typeof value !== "string") throw new Error("value must be a string");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 2_000) {
    throw new Error("string must be between 1 and 2000 characters");
  }
  return normalized;
}
