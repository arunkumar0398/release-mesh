import { describe, expect, it, vi } from "vitest";

import { DefaultMandatoryCheckExecutor } from "./mandatory-check-executor.js";

describe("DefaultMandatoryCheckExecutor", () => {
  it.each([
    ["v2", "FAILED", true, "failed", false],
    ["v2.1", "PASSED", false, "passed", true]
  ] as const)(
    "maps trusted %s checks to deterministic evidence",
    async (candidateVersion, status, incompatible, apiOutcome, browserPassed) => {
      const executor = new DefaultMandatoryCheckExecutor({
        runBrowserCheck: vi.fn().mockResolvedValue({
          passed: browserPassed,
          screenshot: new Uint8Array([137, 80, 78, 71]),
          testId: "browser-checkout"
        }),
        runPricingApiCheck: vi.fn().mockResolvedValue({
          missingFields: apiOutcome === "passed" ? [] : ["price", "currency"],
          outcome: apiOutcome,
          statusCode: 200,
          testId: "api-pricing"
        })
      });

      await expect(
        executor.runMandatoryChecks({ candidateVersion, releaseId: "release-1" })
      ).resolves.toEqual([
        expect.objectContaining({
          artifact: expect.objectContaining({ kind: "CONTRACT_DIFF" }),
          hasIncompatibleRegisteredDependency: incompatible,
          status,
          testId: "contract-pricing"
        }),
        expect.objectContaining({
          artifact: expect.objectContaining({ kind: "SANITIZED_LOG" }),
          status,
          testId: "api-pricing"
        }),
        expect.objectContaining({
          artifact: expect.objectContaining({ kind: "SCREENSHOT" }),
          status,
          testId: "browser-checkout"
        })
      ]);
    }
  );

  it("turns a Pricing timeout into a processor failure instead of a gate vote", async () => {
    const executor = new DefaultMandatoryCheckExecutor({
      runBrowserCheck: vi.fn(),
      runPricingApiCheck: vi.fn().mockResolvedValue({
        errorCode: "TIMEOUT",
        outcome: "error",
        statusCode: null,
        testId: "api-pricing"
      })
    });

    await expect(
      executor.runMandatoryChecks({ candidateVersion: "v2", releaseId: "release-timeout" })
    ).rejects.toThrow("Pricing check failed: TIMEOUT");
  });
});
