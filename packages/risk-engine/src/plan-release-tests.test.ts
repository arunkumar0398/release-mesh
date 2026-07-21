import { describe, expect, it, vi } from "vitest";

import type { RiskPlanningClient } from "./client.js";
import {
  planReleaseTests,
  type ReleasePlanningInput
} from "./plan-release-tests.js";

const input = {
  changedEndpoints: [{ method: "GET", path: "/pricing/:productId" }],
  contractDiff: {
    addedFields: ["amount", "currencyCode"],
    compatible: false,
    missingFields: ["currency", "price"],
    renamedFields: [
      { from: "currency", to: "currencyCode" },
      { from: "price", to: "amount" }
    ],
    typeMismatches: []
  },
  dependencyGraph: [{
    consumer: "checkout",
    expectedContractVersion: "v1",
    provider: "pricing",
    requiredEndpoints: ["GET /pricing/:productId"]
  }],
  trustedTests: [
    { id: "contract-pricing", mandatory: true, type: "contract" },
    { id: "api-pricing", mandatory: true, type: "api" },
    { id: "browser-checkout", mandatory: true, type: "browser" }
  ]
} satisfies ReleasePlanningInput;

describe("planReleaseTests", () => {
  it("uses validated GPT advice while preserving the mandatory registry", async () => {
    const planTests = vi.fn().mockResolvedValue({
      affectedComponents: ["checkout"],
      advisoryTests: [{
        id: "browser-checkout",
        reason: "Checkout consumes the changed Pricing endpoint."
      }],
      expectedRiskAreas: ["Checkout price rendering"]
    });
    const client: RiskPlanningClient = { planTests };

    await expect(planReleaseTests({ client, input })).resolves.toEqual({
      planning: {
        affectedComponents: ["checkout"],
        advisoryTests: [{
          id: "browser-checkout",
          reason: "Checkout consumes the changed Pricing endpoint."
        }],
        expectedRiskAreas: ["Checkout price rendering"]
      },
      selectedTestIds: ["contract-pricing", "api-pricing", "browser-checkout"],
      source: "GPT-5.6"
    });
    expect(planTests).toHaveBeenCalledWith(input);
  });

  it.each([
    ["no client", null],
    ["request failure", { planTests: vi.fn().mockRejectedValue(new Error("timeout")) }],
    ["untrusted output", { planTests: vi.fn().mockResolvedValue({
      affectedComponents: [],
      advisoryTests: [{ id: "arbitrary-script", reason: "Run arbitrary code." }],
      expectedRiskAreas: []
    }) }]
  ])("falls back to every mandatory test on %s", async (_scenario, client) => {
    await expect(planReleaseTests({
      client: client as RiskPlanningClient | null,
      input
    })).resolves.toMatchObject({
      planning: { advisoryTests: [] },
      selectedTestIds: ["contract-pricing", "api-pricing", "browser-checkout"],
      source: "mandatory/default"
    });
  });
});
