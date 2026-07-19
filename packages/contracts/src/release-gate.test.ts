import { describe, expect, it } from "vitest";

import { decideReleaseGate } from "./release-gate.js";

const completeChecks = {
  evidenceComplete: true,
  mandatoryTests: [{ id: "contract-pricing", status: "PASSED" as const }],
  requiredChecksCompleted: true
};

describe("decideReleaseGate", () => {
  it("returns SAFE when compatible checks and evidence succeed", () => {
    expect(
      decideReleaseGate({
        ...completeChecks,
        hasIncompatibleRegisteredDependency: false
      })
    ).toBe("SAFE");
  });

  it("returns BLOCKED for an incompatible registered dependency", () => {
    expect(
      decideReleaseGate({
        ...completeChecks,
        hasIncompatibleRegisteredDependency: true
      })
    ).toBe("BLOCKED");
  });

  it("returns BLOCKED when a mandatory test fails", () => {
    expect(
      decideReleaseGate({
        ...completeChecks,
        hasIncompatibleRegisteredDependency: false,
        mandatoryTests: [{ id: "browser-checkout", status: "FAILED" }]
      })
    ).toBe("BLOCKED");
  });

  it("returns ERROR when required checks or evidence are incomplete", () => {
    expect(
      decideReleaseGate({
        ...completeChecks,
        evidenceComplete: false,
        hasIncompatibleRegisteredDependency: false
      })
    ).toBe("ERROR");
  });
});
