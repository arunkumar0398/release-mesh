import { describe, expect, it } from "vitest";

import { resolveTrustedTests, trustedTestRegistry } from "./test-registry.js";

describe("trusted test registry", () => {
  it("registers only the bundled Checkout and Pricing checks", () => {
    expect(Object.keys(trustedTestRegistry)).toEqual([
      "contract-pricing",
      "api-pricing",
      "browser-checkout"
    ]);
  });

  it("keeps every mandatory test when advisory selection is empty", () => {
    expect(resolveTrustedTests([]).map(({ id }) => id)).toEqual([
      "contract-pricing",
      "api-pricing",
      "browser-checkout"
    ]);
  });

  it("rejects arbitrary test selections instead of executing them", () => {
    expect(() => resolveTrustedTests(["pnpm --filter attacker test"])).toThrowError(
      "Untrusted test id: pnpm --filter attacker test"
    );
    expect(() => resolveTrustedTests(["toString"])).toThrowError("Untrusted test id: toString");
  });
});
