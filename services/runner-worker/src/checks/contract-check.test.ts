import { describe, expect, it } from "vitest";

import { runPricingContractCheck } from "./contract-check.js";

describe("runPricingContractCheck", () => {
  it("fails Pricing v2 with deterministic rename evidence", () => {
    expect(runPricingContractCheck("v2")).toMatchObject({
      candidateVersion: "v2",
      expectedVersion: "v1",
      passed: false,
      testId: "contract-pricing",
      diff: {
        compatible: false,
        missingFields: ["currency", "price"],
        renamedFields: [
          { from: "currency", to: "currencyCode" },
          { from: "price", to: "amount" }
        ]
      }
    });
  });

  it("passes Pricing v2.1 because the v1 aliases remain", () => {
    expect(runPricingContractCheck("v2.1")).toMatchObject({
      candidateVersion: "v2.1",
      expectedVersion: "v1",
      passed: true,
      testId: "contract-pricing",
      diff: {
        compatible: true,
        missingFields: []
      }
    });
  });
});
