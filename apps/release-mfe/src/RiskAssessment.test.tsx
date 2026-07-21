// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RiskAssessment } from "./RiskAssessment.js";

afterEach(cleanup);

const assessment = {
  blastRadius: ["Checkout cannot render Pricing v2."],
  compatibleRemediation: "Add price and currency compatibility aliases.",
  confidence: "HIGH" as const,
  evidenceLinks: [{
    artifactId: "artifact-contract",
    explanation: "The contract diff removes Checkout's required fields."
  }],
  rootCause: "Pricing v2 renamed fields required by Checkout.",
  source: "GPT-5.6" as const,
  uncertainty: "Only registered consumers were evaluated.",
  verificationSteps: ["Run every mandatory trusted test."]
};

describe("RiskAssessment", () => {
  it("renders validated GPT explanation, evidence, confidence, remediation, and verification", () => {
    render(<RiskAssessment value={{ assessment, status: "AVAILABLE" }} />);

    const panel = screen.getByRole("region", { name: "Risk assessment" });
    expect(within(panel).getByText("GPT-5.6 advisory explanation")).toBeInTheDocument();
    expect(within(panel).getByText(assessment.rootCause)).toBeInTheDocument();
    expect(within(panel).getByText("Confidence: HIGH")).toBeInTheDocument();
    expect(within(panel).getByText(assessment.compatibleRemediation)).toBeInTheDocument();
    expect(within(panel).getByText(assessment.verificationSteps[0])).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: /contract diff removes/i })).toHaveAttribute(
      "href",
      "#artifact-artifact-contract"
    );
    expect(within(panel).getByText(/deterministic gate remains the release authority/i)).toBeInTheDocument();
  });

  it("labels AI_UNAVAILABLE content as deterministic/rule-based", () => {
    render(<RiskAssessment value={{
      assessment: {
        ...assessment,
        rootCause: "Deterministic gate BLOCKED was computed from mandatory trusted checks.",
        source: "deterministic/rule-based"
      },
      status: "AI_UNAVAILABLE"
    }} />);

    const panel = screen.getByRole("region", { name: "Risk assessment" });
    expect(within(panel).getByText("deterministic/rule-based fallback")).toBeInTheDocument();
    expect(within(panel).getByText(/Deterministic gate BLOCKED/)).toBeInTheDocument();
    expect(within(panel).queryByText("GPT-5.6 advisory explanation")).not.toBeInTheDocument();
  });
});
