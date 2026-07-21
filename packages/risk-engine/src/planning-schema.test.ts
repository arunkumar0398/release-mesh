import { describe, expect, it } from "vitest";

import { parsePlanningOutput } from "./planning-schema.js";
import { selectAdvisoryTests } from "./select-advisory-tests.js";

const trustedTestIds = ["contract-pricing", "api-pricing", "browser-checkout"] as const;

describe("parsePlanningOutput", () => {
  it("accepts schema-valid selections from the trusted registry", () => {
    expect(parsePlanningOutput({
      affectedComponents: ["checkout"],
      advisoryTests: [{ id: "browser-checkout", reason: "Checkout consumes the changed endpoint." }],
      expectedRiskAreas: ["Pricing response field compatibility"]
    }, trustedTestIds)).toEqual({
      affectedComponents: ["checkout"],
      advisoryTests: [{ id: "browser-checkout", reason: "Checkout consumes the changed endpoint." }],
      expectedRiskAreas: ["Pricing response field compatibility"]
    });
  });

  it.each([
    ["unknown test", {
      affectedComponents: ["checkout"],
      advisoryTests: [{ id: "run-shell-command", reason: "Try arbitrary code." }],
      expectedRiskAreas: []
    }],
    ["release authority", {
      affectedComponents: ["checkout"],
      advisoryTests: [],
      expectedRiskAreas: [],
      gate: "SAFE"
    }],
    ["missing reason", {
      affectedComponents: ["checkout"],
      advisoryTests: [{ id: "browser-checkout" }],
      expectedRiskAreas: []
    }],
    ["duplicate advisory test", {
      affectedComponents: ["checkout"],
      advisoryTests: [
        { id: "browser-checkout", reason: "First reason." },
        { id: "browser-checkout", reason: "Second reason." }
      ],
      expectedRiskAreas: []
    }]
  ])("rejects %s output", (_scenario, output) => {
    expect(() => parsePlanningOutput(output, trustedTestIds)).toThrow("Invalid GPT planning output");
  });
});

describe("selectAdvisoryTests", () => {
  it("returns the stable union of mandatory and advisory trusted tests", () => {
    const planning = parsePlanningOutput({
      affectedComponents: ["checkout"],
      advisoryTests: [
        { id: "browser-checkout", reason: "Exercise the affected consumer." },
        { id: "api-pricing", reason: "Verify the changed endpoint." }
      ],
      expectedRiskAreas: ["Checkout price rendering"]
    }, trustedTestIds);

    expect(selectAdvisoryTests({
      mandatoryTestIds: ["contract-pricing", "api-pricing"],
      planning,
      trustedTestIds
    })).toEqual(["contract-pricing", "api-pricing", "browser-checkout"]);
  });

  it("cannot remove mandatory tests when GPT selects none", () => {
    const planning = parsePlanningOutput({
      affectedComponents: [],
      advisoryTests: [],
      expectedRiskAreas: []
    }, trustedTestIds);

    expect(selectAdvisoryTests({
      mandatoryTestIds: trustedTestIds,
      planning,
      trustedTestIds
    })).toEqual(trustedTestIds);
  });

  it("rejects an untrusted mandatory registry entry", () => {
    expect(() => selectAdvisoryTests({
      mandatoryTestIds: ["contract-pricing", "arbitrary-script"],
      planning: {
        affectedComponents: [],
        advisoryTests: [],
        expectedRiskAreas: []
      },
      trustedTestIds
    })).toThrow("Untrusted mandatory test id: arbitrary-script");
  });
});
