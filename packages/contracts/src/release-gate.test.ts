import { describe, expect, it } from "vitest";

import { decideReleaseGate } from "./release-gate.js";

const completeChecks = {
  evidenceComplete: true,
  expectedMandatoryTestIds: ["contract-pricing"],
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
        expectedMandatoryTestIds: ["browser-checkout"],
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

  it.each([
    ["missing", []],
    [
      "duplicate",
      [
        { id: "contract-pricing", status: "PASSED" as const },
        { id: "contract-pricing", status: "PASSED" as const }
      ]
    ],
    ["unknown", [{ id: "browser-checkout", status: "PASSED" as const }]]
  ])("returns ERROR for %s mandatory-test results", (_scenario, mandatoryTests) => {
    expect(
      decideReleaseGate({
        ...completeChecks,
        hasIncompatibleRegisteredDependency: false,
        mandatoryTests
      })
    ).toBe("ERROR");
  });

  it("returns ERROR when no mandatory tests are expected", () => {
    expect(
      decideReleaseGate({
        ...completeChecks,
        expectedMandatoryTestIds: [],
        hasIncompatibleRegisteredDependency: false,
        mandatoryTests: []
      })
    ).toBe("ERROR");
  });
});
