import { describe, expect, it } from "vitest";

import { parseAnalysisOutput } from "./analysis-schema.js";

const validOutput = {
  blastRadius: ["Checkout cannot render the Pricing response."],
  compatibleRemediation: "Restore price and currency compatibility aliases.",
  confidence: "HIGH",
  evidenceLinks: [{ artifactId: "contract-artifact", explanation: "The contract diff removes price." }],
  rootCause: "Pricing v2 renamed fields required by Checkout.",
  uncertainty: "The analysis is limited to the registered Checkout consumer.",
  verificationSteps: ["Run every mandatory trusted test."]
};

describe("parseAnalysisOutput", () => {
  it("accepts a strict evidence-linked analysis", () => {
    expect(parseAnalysisOutput(validOutput, ["contract-artifact"])).toEqual(validOutput);
  });

  it.each([
    ["release authority", { ...validOutput, gate: "SAFE" }],
    ["unknown evidence", {
      ...validOutput,
      evidenceLinks: [{ artifactId: "invented-artifact", explanation: "Unsupported evidence." }]
    }],
    ["missing evidence grounding", { ...validOutput, evidenceLinks: [] }],
    ["invalid confidence", { ...validOutput, confidence: "CERTAIN" }],
    ["missing remediation", { ...validOutput, compatibleRemediation: undefined }]
  ])("rejects %s in GPT analysis", (_scenario, output) => {
    expect(() => parseAnalysisOutput(output, ["contract-artifact"])).toThrow(
      "Invalid GPT analysis output"
    );
  });
});
