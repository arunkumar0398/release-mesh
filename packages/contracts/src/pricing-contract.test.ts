import { describe, expect, it } from "vitest";

import { diffContract } from "./contract-diff.js";
import { pricingContracts } from "./pricing-contract.js";

describe("Pricing contract compatibility", () => {
  it("accepts Pricing v1 for the Checkout v1 consumer", () => {
    expect(diffContract(pricingContracts.v1, pricingContracts.v1)).toEqual({
      compatible: true,
      addedFields: [],
      missingFields: [],
      renamedFields: [],
      typeMismatches: []
    });
  });

  it("rejects Pricing v2 and reports its breaking field renames", () => {
    expect(diffContract(pricingContracts.v1, pricingContracts.v2)).toEqual({
      compatible: false,
      addedFields: ["amount", "currencyCode"],
      missingFields: ["currency", "price"],
      renamedFields: [
        { from: "currency", to: "currencyCode" },
        { from: "price", to: "amount" }
      ],
      typeMismatches: []
    });
  });

  it("accepts Pricing v2.1 because it preserves the v1 compatibility aliases", () => {
    expect(diffContract(pricingContracts.v1, pricingContracts["v2.1"])).toEqual({
      compatible: true,
      addedFields: ["amount", "currencyCode"],
      missingFields: [],
      renamedFields: [],
      typeMismatches: []
    });
  });

  it("rejects a field whose type changes", () => {
    expect(
      diffContract(pricingContracts.v1, {
        fields: {
          currency: { semanticId: "currency", type: "string" },
          price: { semanticId: "price", type: "string" }
        },
        version: "invalid"
      })
    ).toEqual({
      compatible: false,
      addedFields: [],
      missingFields: [],
      renamedFields: [],
      typeMismatches: [{ actual: "string", expected: "number", field: "price" }]
    });
  });
});
